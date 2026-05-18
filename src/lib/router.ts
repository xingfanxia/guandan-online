// Hash-based router for the lobby + game flow.
//
// Routes:
//   #/                              → Landing
//   #/create                        → CreateRoom
//   #/wait?code=<code>              → Waiting (room lobby; reads credentials from identity store)
//   #/table?code=<code>             → GameTable (live SSE)
//   #/table=<roomId>&token=<t>&me=<handle>   → legacy direct-launch hash (preserved for dev URLs)
//
// Encoded as the hash fragment so each route survives a hard reload without
// server-side rewrite rules. `parseHash` returns a discriminated union the
// App component switches on.

export type Route =
  | { kind: 'landing' }
  | { kind: 'create' }
  | { kind: 'wait'; code: string }
  | { kind: 'table'; code: string }
  | { kind: 'table-legacy'; roomId: string; joinToken: string; myHandle: string };

export function parseHash(hash: string): Route {
  if (!hash.startsWith('#')) return { kind: 'landing' };
  const rest = hash.slice(1);

  // Legacy launch link: #table=<roomId>&token=<t>&me=<handle>
  // Preserved so existing UI-2 dev URLs continue to work.
  if (rest.startsWith('table=')) {
    const params = new URLSearchParams(rest);
    const roomId = params.get('table');
    const joinToken = params.get('token');
    const myHandle = params.get('me');
    if (roomId && joinToken && myHandle) {
      return { kind: 'table-legacy', roomId, joinToken, myHandle };
    }
    return { kind: 'landing' };
  }

  // New format: #/path?param=value
  const [pathRaw, queryRaw] = rest.split('?');
  const path = (pathRaw ?? '').replace(/^\//, '');
  const params = new URLSearchParams(queryRaw ?? '');

  if (path === '' || path === '/') return { kind: 'landing' };
  if (path === 'create') return { kind: 'create' };
  if (path === 'wait') {
    const code = params.get('code');
    if (!code) return { kind: 'landing' };
    return { kind: 'wait', code };
  }
  if (path === 'table') {
    const code = params.get('code');
    if (!code) return { kind: 'landing' };
    return { kind: 'table', code };
  }
  return { kind: 'landing' };
}

export function buildHash(route: Route): string {
  switch (route.kind) {
    case 'landing':
      return '#/';
    case 'create':
      return '#/create';
    case 'wait':
      return `#/wait?code=${encodeURIComponent(route.code)}`;
    case 'table':
      return `#/table?code=${encodeURIComponent(route.code)}`;
    case 'table-legacy':
      return `#table=${route.roomId}&token=${route.joinToken}&me=${encodeURIComponent(route.myHandle)}`;
  }
}

export function navigate(route: Route): void {
  if (typeof window === 'undefined') return;
  const next = buildHash(route);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}
