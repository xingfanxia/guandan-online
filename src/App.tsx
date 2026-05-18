// App shell — wires OrientationLock around the active surface.
//
// Until UI-3 (landing) lands, this renders a status banner on desktop /
// landscape mobile, and the rotate-prompt on portrait mobile. The hash-route
// `#table=<roomId>&token=<joinToken>&me=<handle>` mounts GameTable4P
// against a live SSE stream — useful for manual dev-server testing today.

import { useEffect, useState } from 'react';
import { OrientationLock } from '@/components/OrientationLock';
import { GameTable4P } from '@/screens/GameTable4P';

interface TableLaunchParams {
  roomId: string;
  joinToken: string;
  myHandle: string;
}

function parseHash(hash: string): TableLaunchParams | null {
  if (!hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));
  const roomId = params.get('table');
  const joinToken = params.get('token');
  const myHandle = params.get('me');
  if (!roomId || !joinToken || !myHandle) return null;
  return { roomId, joinToken, myHandle };
}

export default function App(): React.JSX.Element {
  const [launch, setLaunch] = useState<TableLaunchParams | null>(() =>
    typeof window !== 'undefined' ? parseHash(window.location.hash) : null,
  );

  useEffect(() => {
    const onHash = (): void => setLaunch(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <OrientationLock>
      {launch ? (
        <GameTable4P
          roomId={launch.roomId}
          joinToken={launch.joinToken}
          myHandle={launch.myHandle}
        />
      ) : (
        <main style={{ padding: '2rem', fontFamily: 'var(--font-sans, system-ui)' }}>
          <h1>掼蛋联机 (Guandan Online)</h1>
          <p>
            UI-1 / UI-2 shipped — Card / Hand / Trick / Avatar primitives + 4P table.
            To open a live table, navigate to{' '}
            <code>#table=&lt;roomId&gt;&amp;token=&lt;joinToken&gt;&amp;me=@handle</code>.
          </p>
          <p>Landing (UI-3), tribute (UI-4), round-end (UI-5), 6/8P (UI-6) still pending.</p>
        </main>
      )}
    </OrientationLock>
  );
}
