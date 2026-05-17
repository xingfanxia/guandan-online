// GET /api/health — liveness probe. Used by monitoring + smoke deploys.
// Vercel auto-detects this file as a Node serverless function.

export const config = {
  runtime: 'nodejs22.x',
};

export default function handler(_req: Request): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'guandan-online',
      ts: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
}
