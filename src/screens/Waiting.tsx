// Waiting — pre-game lobby. Ports demos/index.html S10.
//
// Polls GET /api/room/[code] every 3s for membership changes. (SSE not used
// here — lobby room_joined / room_left events are fanned out but we currently
// only have credentials issued AFTER joining; lobby polling is simpler than
// stand-up SSE for ROOM-1 + AUTH-1 scope. Phase-change to in_game is detected
// here and triggers the table navigation.)
//
// Host can:
//   • Copy invite link to clipboard (writes /r/<code> URL)
//   • Start game (POST /api/room/[code]/start) when room is full
//   • Dissolve room (POST /api/room/[code]/leave with host token)
//
// Non-host can:
//   • Leave room (POST /api/room/[code]/leave with own join token)
//
// On phase=in_game (set by /start), all clients navigate to #/table?code=<code>.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRoom,
  startGame,
  leaveRoom as apiLeaveRoom,
  seatCountForMode,
  RoomApiError,
  type PublicRoomState,
} from '@/lib/api/rooms';
import {
  getCredentialsForRoom,
  clearCredentials,
  type RoomCredentials,
} from '@/lib/identity';
import { navigate } from '@/lib/router';
import { HostIPWarning } from '@/components/HostIPWarning';

export interface WaitingProps {
  code: string;
  /** Override credentials for testing — bypasses identity store read. */
  initialCredentials?: RoomCredentials | null;
  /** Override initial room state for tests; skips the first fetch. */
  initialRoom?: PublicRoomState;
  /** Override fetch — tests stub. */
  getRoomFn?: typeof getRoom;
  /** Override start — tests stub. */
  startFn?: typeof startGame;
  /** Override leave — tests stub. */
  leaveFn?: typeof apiLeaveRoom;
  /** Override navigate — tests assert. */
  navigateFn?: typeof navigate;
  /** Poll interval ms — tests pass 0 to disable. */
  pollMs?: number;
}

export function Waiting({
  code,
  initialCredentials,
  initialRoom,
  getRoomFn = getRoom,
  startFn = startGame,
  leaveFn = apiLeaveRoom,
  navigateFn = navigate,
  pollMs = 3000,
}: WaitingProps): React.JSX.Element {
  const credentials =
    initialCredentials !== undefined
      ? initialCredentials
      : getCredentialsForRoom(code);

  const [room, setRoom] = useState<PublicRoomState | null>(initialRoom ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      // SEC-2: host passes its token so the server returns sharedIpGroups
      // (the same-room IP-collision warning). Non-hosts omit it.
      const next = credentials?.hostToken
        ? await getRoomFn(code, { hostToken: credentials.hostToken })
        : await getRoomFn(code);
      setRoom(next);
      setError(null);
      if (next.phase === 'in_game') {
        navigateFn({ kind: 'table', code });
      }
    } catch (err) {
      if (err instanceof RoomApiError && err.code === 'room_not_found') {
        setError('房间已结束或被解散');
        clearCredentials(code);
      } else if (err instanceof RoomApiError) {
        setError(err.details ?? err.code);
      } else {
        setError('刷新失败 — 检查网络');
      }
    }
  }, [code, getRoomFn, navigateFn, credentials?.hostToken]);

  useEffect(() => {
    if (!initialRoom) {
      void refresh();
    }
    if (pollMs <= 0) return undefined;
    const id = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [initialRoom, pollMs, refresh]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  function copyInvite(): void {
    const link = inviteUrl(code);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(link).then(
        () => setCopyFeedback('已复制'),
        () => setCopyFeedback('复制失败')
      );
    } else {
      setCopyFeedback('已复制');
    }
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopyFeedback(null), 2000);
  }

  async function onStart(): Promise<void> {
    if (!credentials?.hostToken) return;
    setBusy(true);
    setError(null);
    try {
      await startFn(code, credentials.hostToken);
      navigateFn({ kind: 'table', code });
    } catch (err) {
      const msg =
        err instanceof RoomApiError
          ? err.code === 'conflict'
            ? err.details ?? '房间未就绪'
            : (err.details ?? err.code)
          : '开始失败 — 检查网络';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onLeave(): Promise<void> {
    if (!credentials) {
      navigateFn({ kind: 'landing' });
      return;
    }
    setBusy(true);
    try {
      await leaveFn(code, credentials.joinToken);
    } catch (err) {
      // We still navigate away — leave is fire-and-forget UX.
      console.warn('leaveRoom failed', err);
    }
    clearCredentials(code);
    navigateFn({ kind: 'landing' });
  }

  if (!room) {
    return (
      <div className="waiting">
        <header className="waiting__top">
          <div className="waiting__top-group">
            <span className="waiting__top-key">ROOM</span>
            <span className="waiting__top-val">{code}</span>
          </div>
          <span className="waiting__top-val">{error ? error : '正在载入…'}</span>
        </header>
      </div>
    );
  }

  const seats = seatCountForMode(room.mode);
  const isHost = credentials?.playerId === room.hostId;
  const allReady = room.members.length === seats;

  return (
    <div className="waiting">
      <header className="waiting__top">
        <div className="waiting__top-group">
          <span className="waiting__top-key">ROOM</span>
          <span className="waiting__top-val">{code}</span>
          <span className="chip mono">{seats}P · {aLevelLabel(room.rules)}</span>
          <span className="chip chip--info mono">CONFIGURING</span>
        </div>
        <div className="waiting__top-group">
          <span className="waiting__top-key">房主</span>
          <span className="waiting__top-val">
            {room.members.find((m) => m.id === room.hostId)?.handle ?? '?'}
          </span>
        </div>
      </header>

      <div className="waiting__body">
        <section className="waiting__left">
          {isHost && room.sharedIpGroups && room.sharedIpGroups.length > 0 ? (
            <HostIPWarning groups={room.sharedIpGroups} />
          ) : null}
          <span className="waiting__eyebrow">
            {isHost ? '房主配置中' : '等待房主开局'}
          </span>
          <h2 className="waiting__title">
            配置桌位 · <em>{room.members.length}</em>/{seats} 已就绪
          </h2>
          <p className="waiting__lede">
            {isHost
              ? '每个座位由房主指派：等真人加入 / 填一个 AI（含难度选择）。开始游戏 在所有座位就位后激活。'
              : '等房主把座位填满后开局。可以随时离开重新选择。'}
          </p>

          <div className="waiting__invite">
            <div className="waiting__invite-info">
              <div className="waiting__invite-label">邀请链接 · IM 分享</div>
              <div className="waiting__invite-link">{inviteUrl(code)}</div>
            </div>
            {copyFeedback ? (
              <span className="waiting__copy-feedback">{copyFeedback}</span>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={copyInvite}
              aria-label="复制邀请链接"
            >
              复制
            </button>
          </div>

          {error ? <div className="waiting__error">{error}</div> : null}

          <div className="waiting__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onLeave}
              disabled={busy}
            >
              {isHost ? '解散房间' : '离开房间'}
            </button>
            {isHost ? (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                style={{ flex: 1 }}
                onClick={onStart}
                disabled={busy || !allReady}
                title={
                  allReady
                    ? '开始游戏'
                    : `等 ${seats - room.members.length} 座位`
                }
              >
                {busy
                  ? '开局中…'
                  : allReady
                    ? '开始游戏'
                    : `开始游戏 · 等 ${seats - room.members.length} 座位`}
              </button>
            ) : null}
          </div>
        </section>

        <section
          className="waiting__slots"
          role="list"
          aria-label="座位列表"
        >
          {Array.from({ length: seats }, (_, i) => {
            const member = room.members[i];
            if (!member) {
              return (
                <div
                  key={`empty-${i}`}
                  className="waiting__slot waiting__slot--empty"
                  role="listitem"
                >
                  <div className="avatar avatar--md" style={{ borderStyle: 'dashed' }}>？</div>
                  <div className="waiting__slot-info">
                    <span className="waiting__slot-name">
                      座 {i + 1} · 队 {i % 2 === 0 ? 'A' : 'B'}
                    </span>
                    <div className="waiting__slot-tiers">
                      <span className="chip mono">等真人</span>
                    </div>
                  </div>
                </div>
              );
            }
            const teamClass = i % 2 === 0 ? 'waiting__slot-team--t1' : 'waiting__slot-team--t2';
            const isMe = member.id === credentials?.playerId;
            const isBot = member.status === 'bot';
            return (
              <div
                key={member.id}
                className={`waiting__slot${isBot ? ' waiting__slot--bot' : ''}`}
                role="listitem"
              >
                <div
                  className={`avatar avatar--md ${isMe ? 'avatar--self' : i % 2 === 0 ? 'avatar--partner' : 'avatar--rival-1'}`}
                >
                  {isBot ? BOT_BADGE[member.difficulty ?? 'medium'] : avatarInitials(member.handle)}
                </div>
                <div className="waiting__slot-info">
                  <span className="waiting__slot-name">
                    {member.handle}
                    {member.id === room.hostId ? (
                      <span className="chip mono" style={{ fontSize: 9, padding: '1px 5px' }}>
                        房主
                      </span>
                    ) : null}
                    {isMe ? (
                      <span className="chip chip--info mono" style={{ fontSize: 9, padding: '1px 5px' }}>
                        我
                      </span>
                    ) : null}
                    {isBot ? (
                      <span
                        className="chip mono"
                        style={{ fontSize: 9, padding: '1px 5px' }}
                        aria-label={`AI ${member.difficulty ?? 'medium'}`}
                      >
                        AI · {BOT_TIER_LABEL[member.difficulty ?? 'medium']}
                      </span>
                    ) : null}
                  </span>
                  <span className="waiting__slot-meta">
                    <span className={`waiting__slot-team ${teamClass}`} />
                    座 {i + 1} · 队 {i % 2 === 0 ? 'A' : 'B'}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

function inviteUrl(code: string): string {
  if (typeof window === 'undefined') {
    return `https://gdo.ax0x.ai/r/${code}`;
  }
  return `${window.location.origin}/?room=${code}`;
}

/**
 * Compose the "A 级" chip label from the room's rule overrides. When the
 * server hasn't surfaced rules (older API or omitted), fall back to a
 * generic "A 级" without the strict/loose qualifier — better than the
 * previous hardcoded "宽松 A" which lied about strict rooms.
 */
function aLevelLabel(rules?: import('@/lib/api/rooms').PublicModeRules): string {
  if (!rules || rules.strictA === undefined) return 'A 级';
  return rules.strictA ? '严格 A' : '宽松 A';
}

function avatarInitials(handle: string): string {
  const body = handle.replace(/^@/, '');
  // Prefer the first 2 chars; for CJK this picks one + one, for ASCII two letters.
  return body.slice(0, 2).toUpperCase();
}

const BOT_BADGE: Record<'easy' | 'medium', string> = {
  easy: '🌱',
  medium: '⚡',
};

const BOT_TIER_LABEL: Record<'easy' | 'medium', string> = {
  easy: '入门',
  medium: '进阶',
};
