// Placeholder app shell. Real landing page lands with UI-3 (Phase 2).
// Until then, this confirms the bootstrap works end-to-end (vite → react → render).

export default function App() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>掼蛋联机 (Guandan Online)</h1>
      <p>Bootstrap OK. Pre-implementation done — see <code>docs/plan/PLAN.md</code>.</p>
      <ul>
        <li>P0 in flight: CORE-1 / AUTH-1 / NET-1</li>
        <li>UI lands with UI-1/UI-2 in Phase 1</li>
      </ul>
    </main>
  );
}
