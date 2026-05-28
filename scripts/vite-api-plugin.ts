// Vite middleware plugin that mounts the production Vercel Functions in
// `api/` as Connect middleware on the Vite dev server. This gives `npm run
// dev` (and Playwright e2e) a single-origin server with both the SPA and
// the REST + SSE surfaces — no separate `vercel dev` cold-start.
//
// Each Vercel route is imported eagerly so handler-level module state
// (e.g. infraCache, rateLimiter) is shared across requests, matching
// production-runtime semantics.

import type { Plugin, Connect, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import * as healthRoute from '../api/health.js';
import * as createRoomRoute from '../api/room/create.js';
import * as roomCodeRoute from '../api/room/[code].js';
import * as joinRoute from '../api/room/[code]/join.js';
import * as leaveRoute from '../api/room/[code]/leave.js';
import * as startRoute from '../api/room/[code]/start.js';
import * as moveRoute from '../api/room/[code]/move.js';
import * as sseRoute from '../api/sse/[roomId].js';
import * as cronRoute from '../api/cron/cleanup-rooms.js';
import * as reportRoute from '../api/report.js';
import * as adminReportsRoute from '../api/admin/reports.js';
import * as adminBanRoute from '../api/admin/ban.js';
import * as adminResetStatsRoute from '../api/admin/reset-stats.js';
import * as telemetryLatencyRoute from '../api/telemetry/latency.js';

type WebHandler = (request: Request) => Promise<Response> | Response;

interface RouteEntry {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handler: WebHandler;
}

const routes: ReadonlyArray<RouteEntry> = [
  { method: 'GET', pattern: /^\/api\/health\/?$/, handler: healthRoute.GET },
  { method: 'POST', pattern: /^\/api\/room\/create\/?$/, handler: createRoomRoute.POST },
  { method: 'POST', pattern: /^\/api\/room\/[^/]+\/join\/?$/, handler: joinRoute.POST },
  { method: 'POST', pattern: /^\/api\/room\/[^/]+\/leave\/?$/, handler: leaveRoute.POST },
  { method: 'POST', pattern: /^\/api\/room\/[^/]+\/start\/?$/, handler: startRoute.POST },
  { method: 'POST', pattern: /^\/api\/room\/[^/]+\/move\/?$/, handler: moveRoute.POST },
  { method: 'GET', pattern: /^\/api\/room\/[^/]+\/?$/, handler: roomCodeRoute.GET },
  { method: 'GET', pattern: /^\/api\/sse\/[^/]+\/?(\?.*)?$/, handler: sseRoute.GET },
  { method: 'GET', pattern: /^\/api\/cron\/cleanup-rooms\/?$/, handler: cronRoute.GET },
  // SEC-3 report + admin moderation; DEPLOY-2 latency telemetry.
  { method: 'POST', pattern: /^\/api\/report\/?$/, handler: reportRoute.POST },
  { method: 'GET', pattern: /^\/api\/admin\/reports\/?$/, handler: adminReportsRoute.GET },
  { method: 'POST', pattern: /^\/api\/admin\/ban\/?$/, handler: adminBanRoute.POST },
  { method: 'POST', pattern: /^\/api\/admin\/reset-stats\/?$/, handler: adminResetStatsRoute.POST },
  { method: 'POST', pattern: /^\/api\/telemetry\/latency\/?$/, handler: telemetryLatencyRoute.POST },
  { method: 'GET', pattern: /^\/api\/telemetry\/latency\/?$/, handler: telemetryLatencyRoute.GET },
];

async function nodeToWebRequest(
  req: IncomingMessage,
  baseUrl: string
): Promise<Request> {
  const url = new URL(req.url ?? '/', baseUrl);
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const entry of v) headers.append(k, entry);
    } else {
      headers.set(k, String(v));
    }
  }

  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length > 0) {
      body = Buffer.concat(chunks);
    }
  }

  return new Request(url.toString(), {
    method,
    headers,
    // Cast through unknown — @types/node@25's RequestInit doesn't expose a
    // BodyInit type that includes Node Buffer, but the runtime fetch impl
    // accepts Buffer via ArrayBufferView duck-typing.
    body: (body ?? null) as unknown as RequestInit['body'],
  });
}

async function writeWebResponse(
  webRes: Response,
  res: ServerResponse
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  const nodeStream = Readable.from(
    (async function* () {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        yield value;
      }
    })()
  );

  await new Promise<void>((resolve, reject) => {
    nodeStream.on('error', reject);
    res.on('close', () => {
      // Client closed before stream finished — abort the upstream reader so
      // SSE handlers can clean up subscriptions.
      try {
        reader.cancel().catch(() => undefined);
      } catch {
        /* noop */
      }
      resolve();
    });
    nodeStream.on('end', () => resolve());
    nodeStream.pipe(res);
  });
}

function findRoute(method: string, pathname: string): RouteEntry | undefined {
  return routes.find(
    (r) => r.method === method.toUpperCase() && r.pattern.test(pathname)
  );
}

export function apiMiddlewarePlugin(): Plugin {
  return {
    name: 'guandan-api-middleware',
    configureServer(server: ViteDevServer): void {
      const middleware: Connect.NextHandleFunction = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction
      ) => {
        const reqUrl = req.url ?? '/';
        if (!reqUrl.startsWith('/api/')) return next();

        // Strip query string for pattern match.
        const [pathname] = reqUrl.split('?');
        const route = findRoute(req.method ?? 'GET', pathname ?? '');
        if (!route) return next();

        try {
          const host = req.headers.host ?? `localhost:${server.config.server.port ?? 5174}`;
          const baseUrl = `http://${host}`;
          const webReq = await nodeToWebRequest(req, baseUrl);
          const webRes = await route.handler(webReq);
          await writeWebResponse(webRes, res);
        } catch (err) {
          console.error('[api-middleware] handler error', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'internal_error' }));
          } else {
            try {
              res.end();
            } catch {
              /* noop */
            }
          }
        }
      };
      // Mount BEFORE Vite's own middlewares so /api/* never falls through to
      // the SPA fallback (which would return index.html).
      server.middlewares.use(middleware);
    },
  };
}
