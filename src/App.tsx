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
import { Landing } from '@/screens/Landing';
import { CreateRoom } from '@/screens/CreateRoom';
import { Waiting } from '@/screens/Waiting';
import { parseHash, type Route } from '@/lib/router';
import { getCredentialsForRoom } from '@/lib/identity';

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
      return (
        <GameTable4P
          roomId={route.code}
          joinToken={creds.joinToken}
          myHandle={creds.playerId}
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
  }
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
