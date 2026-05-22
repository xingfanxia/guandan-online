// Landing — first screen.
//
// Ports demos/index.html S01 to live React. Layout:
//   • Top nav: brand mark · my handle (or "sign in" button if unset)
//   • Left half: hero (eyebrow + title + lede) + 3 CTA stack
//   • Right half: recent rooms list (from identity store — rooms this user has
//     joined / created and still has credentials for. ROOM-3 will add a public-
//     rooms server fetch; for now we show local history + an empty-state hint.)
//
// Three CTAs route via the hash router:
//   • 创建房间 → #/create
//   • 加入房间 → opens code-input modal → call joinRoom() → #/wait?code=…
//   • 浏览房间 → not implemented (ROOM-3) — shows tooltip
//
// Handle persistence: getHandle() reads localStorage. If absent, sign-in modal
// captures one before any CTA fires.

import { useEffect, useMemo, useState } from 'react';
import {
  getHandle,
  setHandle as persistHandle,
  isHandleValidLocally,
  normalizeHandle,
  listRecentCredentials,
  storeCredentials,
  type RoomCredentials,
} from '@/lib/identity';
import { joinRoom, RoomApiError } from '@/lib/api/rooms';
import { navigate } from '@/lib/router';

export interface LandingProps {
  /** Override identity persistence — tests pass a stable handle. */
  initialHandle?: string | null;
  /** Override the room-credentials list — tests pass deterministic entries. */
  initialRecent?: readonly RoomCredentials[];
  /** Override the joinRoom API — tests pass a stub. */
  joinFn?: typeof joinRoom;
  /** Override navigate — tests assert calls. */
  navigateFn?: typeof navigate;
}

export function Landing({
  initialHandle,
  initialRecent,
  joinFn = joinRoom,
  navigateFn = navigate,
}: LandingProps): React.JSX.Element {
  const [handle, setHandleState] = useState<string | null>(
    () => initialHandle ?? getHandle()
  );
  // 'auto' = opened on mount (don't autoFocus — would trigger the
  // OrientationLock bypass before the rotate is visible). 'manual' = user
  // tapped "登录 @handle" and expects to type immediately.
  const [signInOpen, setSignInOpen] = useState<false | 'auto' | 'manual'>(false);
  const [signInDraft, setSignInDraft] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);

  // Mirror the signInOpen tri-state: 'manual' = user-clicked (autofocus the
  // input for immediate typing), 'auto' = opened programmatically (do NOT
  // autofocus — focus would flip OrientationLock into bypass mode before the
  // CSS rotate is visible). Today only the manual path is wired; the tri-
  // state keeps F-M2 robust against future deep-link or auto-open additions.
  const [joinOpen, setJoinOpen] = useState<false | 'auto' | 'manual'>(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const recent = useMemo<readonly RoomCredentials[]>(
    () => initialRecent ?? listRecentCredentials(),
    [initialRecent]
  );

  // Auto-open sign-in if no handle on first paint — but don't on every render.
  useEffect(() => {
    if (!handle && !signInOpen) {
      // Intentional: prompt early. The user can dismiss + browse rooms but
      // CTAs are blocked until set. Use 'auto' so the modal doesn't snatch
      // input focus on mount — that focus would flip OrientationLock into
      // bypass mode and hide the CSS rotate on first paint.
      setSignInOpen('auto');
    }
    // We only want to fire once on mount; subsequent handle changes don't
    // re-open the modal (intentional UX — once they have a handle, no nag).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitHandle(): void {
    const normalized = normalizeHandle(signInDraft);
    if (!isHandleValidLocally(normalized)) {
      setSignInError('Handle 需要 2-16 个字母 / 数字 / 下划线');
      return;
    }
    persistHandle(normalized);
    setHandleState(normalized);
    setSignInDraft('');
    setSignInError(null);
    setSignInOpen(false);
  }

  function openCreate(): void {
    if (!handle) {
      setSignInOpen('manual');
      return;
    }
    navigateFn({ kind: 'create' });
  }

  function openJoin(): void {
    if (!handle) {
      setSignInOpen('manual');
      return;
    }
    setJoinError(null);
    setJoinCode('');
    setJoinOpen('manual');
  }

  async function submitJoin(): Promise<void> {
    if (!handle) return;
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setJoinError('房间码是 6 位字符');
      return;
    }
    setJoinBusy(true);
    setJoinError(null);
    try {
      const res = await joinFn(code, { handle });
      storeCredentials({
        code,
        playerId: res.playerId,
        joinToken: res.joinToken,
        // Persist our handle alongside the playerId so the game-table
        // component can match `evt.players[].handle === myHandle` on
        // snapshot. Without this, App.tsx falls back to the global
        // getHandle() — fine for the active user, but breaks if they
        // changed their handle between joining and entering the table.
        handle,
        storedAt: Date.now(),
      });
      navigateFn({ kind: 'wait', code });
    } catch (err) {
      const msg =
        err instanceof RoomApiError
          ? err.code === 'room_not_found'
            ? '房间不存在或已结束'
            : err.code === 'conflict'
              ? '房间已满或已开局'
              : err.details ?? err.code
          : '加入失败 — 请检查网络';
      setJoinError(msg);
    } finally {
      setJoinBusy(false);
    }
  }

  function rejoinRoom(creds: RoomCredentials): void {
    navigateFn({ kind: 'wait', code: creds.code });
  }

  return (
    <div className="landing">
      <header className="lobby-nav">
        <div className="lobby-nav__brand">
          <span className="lobby-nav__brand-mark">掼·</span>
          <span className="lobby-nav__brand-name">guandan online</span>
        </div>
        {handle ? (
          <div className="lobby-nav__me">
            <span className="lobby-nav__me-handle">{handle}</span>
            <button
              type="button"
              className="lobby-nav__signin"
              onClick={() => setSignInOpen('manual')}
              aria-label="换号"
            >
              切换
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="lobby-nav__signin"
            onClick={() => setSignInOpen('manual')}
          >
            登录 @handle
          </button>
        )}
      </header>

      <div className="landing__body">
        <section className="landing__left">
          <span className="landing__eyebrow">tonight · {currentDayChinese()}</span>
          <h1 className="landing__title">
            想打一把 <em>4 人配对</em>
            <br />
            还是 <em>8 人混战</em>？
          </h1>
          <p className="landing__lede">
            实时联机 · 4 / 6 / 8 人 · 自定义规则 · AI 可填空位
          </p>
          <div className="landing__cta-stack">
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={openCreate}
              aria-label="创建房间"
            >
              创建房间
              <span className="landing__cta-sub">→</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--lg"
              onClick={openJoin}
              aria-label="加入房间"
            >
              加入房间
              <span className="landing__cta-sub">六位房间码</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--lg"
              disabled
              title="ROOM-3 · 公开房间列表（开发中）"
              aria-label="浏览房间"
            >
              浏览房间
              <span className="landing__cta-sub">开发中</span>
            </button>
          </div>
        </section>

        <section className="landing__right">
          <div className="landing__rooms-head">
            <span className="landing__rooms-title">recent · 最近加入</span>
            <span className="landing__rooms-count">
              <em>{recent.length}</em> 间
            </span>
          </div>
          <div className="landing__rooms-list">
            {recent.length === 0 ? (
              <div className="landing__rooms-empty">
                还没有最近的房间。
                <br />
                创建一间或输入房间码加入。
              </div>
            ) : (
              recent.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className="landing__room"
                  onClick={() => rejoinRoom(c)}
                >
                  <span className="landing__room-code mono">{c.code}</span>
                  <div className="landing__room-info">
                    <span className="landing__room-host">
                      {c.hostToken ? '我是房主' : '我已加入'}
                    </span>
                    <span className="landing__room-meta">
                      {formatRelative(Date.now() - c.storedAt)} · {c.playerId}
                    </span>
                  </div>
                  <span className="landing__room-state">重新进入</span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {signInOpen ? (
        <SignInModal
          draft={signInDraft}
          setDraft={setSignInDraft}
          error={signInError}
          autoFocusInput={signInOpen === 'manual'}
          onSubmit={submitHandle}
          onClose={handle ? () => setSignInOpen(false) : undefined}
        />
      ) : null}

      {joinOpen ? (
        <JoinModal
          code={joinCode}
          setCode={setJoinCode}
          busy={joinBusy}
          error={joinError}
          autoFocusInput={joinOpen === 'manual'}
          onSubmit={submitJoin}
          onClose={() => setJoinOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SignInModal({
  draft,
  setDraft,
  error,
  autoFocusInput,
  onSubmit,
  onClose,
}: {
  draft: string;
  setDraft: (s: string) => void;
  error: string | null;
  /** Only autofocus when user explicitly opened the modal — auto-open on
   * mount skips this so the OrientationLock rotate stays visible on first
   * paint. See useEffect in parent. */
  autoFocusInput: boolean;
  onSubmit: () => void;
  onClose?: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="登录 handle">
      <div className="modal">
        <h2 className="modal__title">登录 @handle</h2>
        <p className="modal__label">choose your handle</p>
        <input
          type="text"
          className="modal__input"
          autoFocus={autoFocusInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder="@example"
          aria-label="handle"
        />
        {error ? <p className="modal__error">{error}</p> : null}
        <div className="modal__actions">
          {onClose ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
              取消
            </button>
          ) : null}
          <button type="button" className="btn btn--primary btn--sm" onClick={onSubmit}>
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

function JoinModal({
  code,
  setCode,
  busy,
  error,
  autoFocusInput,
  onSubmit,
  onClose,
}: {
  code: string;
  setCode: (s: string) => void;
  busy: boolean;
  error: string | null;
  /** Only autofocus when user explicitly opened the modal — keeps the
   * OrientationLock CSS-rotate path safe if a future deep-link auto-opens
   * the join modal on mount. Mirrors SignInModal's autoFocusInput prop. */
  autoFocusInput: boolean;
  onSubmit: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="加入房间">
      <div className="modal">
        <h2 className="modal__title">加入房间</h2>
        <p className="modal__label">room code · 6 chars</p>
        <input
          type="text"
          className="modal__input"
          autoFocus={autoFocusInput}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onSubmit();
          }}
          placeholder="K7M2P9"
          maxLength={6}
          aria-label="room code"
        />
        {error ? <p className="modal__error">{error}</p> : null}
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onSubmit}
            disabled={busy || code.length !== 6}
          >
            {busy ? '加入中…' : '加入'}
          </button>
        </div>
      </div>
    </div>
  );
}

function currentDayChinese(): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[new Date().getDay()] ?? 'today';
}

function formatRelative(deltaMs: number): string {
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s 前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h 前`;
  return `${Math.floor(hours / 24)}d 前`;
}
