// App shell — hash router for the full UI-3 flow.
//
// Routes (see src/lib/router.ts):
//   #/                              → Landing (3 CTAs + recent rooms)
//   #/create                        → CreateRoom (mode picker + preview)
//   #/wait?code=<code>              → Waiting (lobby + start)
//   #/table?code=<code>             → GameTable (live SSE) — reads creds from identity store
//   #table=<id>&token=<t>&me=<h>    → GameTable (legacy direct-launch link)
//
// OrientationLock wraps everything so the rotate-prompt fallback fires on
// portrait phones regardless of which screen is active.

import { useEffect, useState } from 'react';
import { OrientationLock } from '@/components/OrientationLock';
import { GameTable4P } from '@/screens/GameTable4P';
import { GameTableMP } from '@/screens/GameTableMP';
import { Landing } from '@/screens/Landing';
import { CreateRoom } from '@/screens/CreateRoom';
import { Waiting } from '@/screens/Waiting';
import { AdminDashboard } from '@/screens/AdminDashboard';
import { parseHash, type Route } from '@/lib/router';
import { getCredentialsForRoom, getHandle } from '@/lib/identity';
import { getRoom, type GameMode } from '@/lib/api/rooms';

export default function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() =>
    typeof window !== 'undefined' ? parseHash(window.location.hash) : { kind: 'landing' }
  );

  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <OrientationLock>
      <RouteSwitch route={route} />
    </OrientationLock>
  );
}

function RouteSwitch({ route }: { route: Route }): React.JSX.Element {
  switch (route.kind) {
    case 'landing':
      return <Landing />;
    case 'create':
      return <CreateRoom />;
    case 'wait':
      return <Waiting code={route.code} />;
    case 'table': {
      const creds = getCredentialsForRoom(route.code);
      if (!creds) {
        return <MissingCreds code={route.code} />;
      }
      // Prefer the handle stored alongside the credentials (mints during
      // create/join carry it from this session). For older credentials
      // persisted before the handle field existed, fall back to the active
      // global handle. If even that's missing we hand an empty string
      // through — the snapshot reducer will simply use evt.you.playerId
      // for myPlayerId, so the rendering still works (HUD just won't show
      // a friendly handle).
      const myHandle = creds.handle ?? getHandle() ?? '';
      return (
        <TableSwitch
          code={route.code}
          joinToken={creds.joinToken}
          myHandle={myHandle}
        />
      );
    }
    case 'table-legacy':
      return (
        <GameTable4P
          roomId={route.roomId}
          joinToken={route.joinToken}
          myHandle={route.myHandle}
        />
      );
    case 'admin':
      return <AdminDashboard token={route.token} />;
  }
}

/**
 * Look up the room's mode (one fetch on mount) and route to the right table
 * component. 4P uses the established GameTable4P; 6P / 8P use GameTableMP
 * (oval layout). Until the fetch resolves we show a small SYNC banner.
 */
function TableSwitch({
  code,
  joinToken,
  myHandle,
}: {
  code: string;
  joinToken: string;
  myHandle: string;
}): React.JSX.Element {
  const [mode, setMode] = useState<GameMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRoom(code)
      .then((r) => {
        if (!cancelled) setMode(r.mode);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <main style={{ padding: '24px 60px' }}>
        <h1>无法载入房间</h1>
        <p>{error}</p>
        <a href="#/" className="btn btn--primary">返回首页</a>
      </main>
    );
  }
  if (mode === null) {
    return (
      <main style={{ padding: '24px 60px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>
          连接 {code}…
        </p>
      </main>
    );
  }
  if (mode === '4') {
    return (
      <GameTable4P roomId={code} joinToken={joinToken} myHandle={myHandle} />
    );
  }
  return (
    <GameTableMP
      mode={mode}
      roomId={code}
      joinToken={joinToken}
      myHandle={myHandle}
    />
  );
}

function MissingCreds({ code }: { code: string }): React.JSX.Element {
  return (
    <main style={{ padding: '24px 60px' }}>
      <h1>需要先加入房间</h1>
      <p>房间 <code>{code}</code> 没有保存的凭据。返回首页加入该房间。</p>
      <a href="#/" className="btn btn--primary">返回首页</a>
    </main>
  );
}
