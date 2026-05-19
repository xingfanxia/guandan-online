// CreateRoom — host creates a new room with mode + (display-only) rule preview.
//
// Ports demos/index.html S02. Left half: segmented mode picker (4/6/8) + AI fill
// row (cosmetic v1 — actual AI seat assignment lands with ROOM-2) + rules grid.
// Right half: room-code placeholder + spec summary + 建立房间 CTA.
//
// On submit:
//   1. POST /api/room/create with {mode, host: {handle}}
//   2. Persist (code, hostToken, hostJoinToken) to identity store
//   3. Navigate to #/wait?code=<code>
//
// Custom rule toggles + per-slot AI difficulty are persisted to the room's
// rules ONLY when ROOM-2 ships server-side validation. For UI-3 they reflect
// in the preview pane (so the visual contract matches the demo) but the
// create call still uses DEFAULT_MODE_RULES.

import { useMemo, useState } from 'react';
import { getHandle, storeCredentials } from '@/lib/identity';
import {
  createRoom,
  RoomApiError,
  seatCountForMode,
  type BotSeat,
  type GameMode,
} from '@/lib/api/rooms';
import { navigate } from '@/lib/router';

interface RuleAxis {
  readonly id: string;
  readonly label: string;
  readonly defaultOn: boolean;
}

const RULE_AXES: readonly RuleAxis[] = [
  { id: 'aLevelStrict', label: 'A 级严格', defaultOn: true },
  { id: 'wildcardHeart', label: '红心通配', defaultOn: true },
  { id: 'lastCallDeclare', label: '报警出最后', defaultOn: false },
  { id: 'steelPlate', label: '钢板可出', defaultOn: true },
  { id: 'triPair', label: '三连对可出', defaultOn: false },
  { id: 'straightFlushAboveBomb5', label: '同花顺 > 5 炸', defaultOn: true },
];

type AiTier = 'easy' | 'medium' | 'human';
const AI_TIER_LABELS: Record<AiTier, string> = {
  human: '等真人',
  easy: 'AI 入门',
  medium: 'AI 进阶',
};
const AI_TIERS: readonly AiTier[] = ['human', 'easy', 'medium'];

export interface CreateRoomProps {
  /** Override identity handle — tests pass deterministic values. */
  initialHandle?: string | null;
  /** Override createRoom API call — tests stub. */
  createFn?: typeof createRoom;
  /** Override navigate — tests assert calls. */
  navigateFn?: typeof navigate;
}

export function CreateRoom({
  initialHandle,
  createFn = createRoom,
  navigateFn = navigate,
}: CreateRoomProps): React.JSX.Element {
  const handle = initialHandle ?? getHandle();

  const [mode, setMode] = useState<GameMode>('4');
  const [rulesOn, setRulesOn] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const axis of RULE_AXES) seed[axis.id] = axis.defaultOn;
    return seed;
  });
  const [aiTiers, setAiTiers] = useState<Record<number, AiTier>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seatCount = seatCountForMode(mode);
  // Seats 2..N (index 1..N-1) are "AI fill" candidates — seat 1 is always us.
  const aiSeats = useMemo(
    () => Array.from({ length: seatCount - 1 }, (_, i) => i + 1),
    [seatCount]
  );

  function toggleRule(id: string): void {
    setRulesOn((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setSeatTier(seat: number, tier: AiTier): void {
    setAiTiers((prev) => ({ ...prev, [seat]: tier }));
  }

  async function submit(): Promise<void> {
    if (!handle) {
      setError('请先设置 @handle');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Convert the chip state into the BotSeat[] the server expects.
      // 'human' chips are NOT seated — the host wants a real player to join
      // that slot. AI tier chips become bot seats in chip-row order.
      const bots: BotSeat[] = [];
      for (const seat of aiSeats) {
        const tier = aiTiers[seat] ?? 'human';
        if (tier !== 'human') bots.push({ tier });
      }
      const createInput: { mode: GameMode; handle: string; bots?: BotSeat[] } =
        bots.length > 0 ? { mode, handle, bots } : { mode, handle };
      const res = await createFn(createInput);
      storeCredentials({
        code: res.code,
        playerId: res.hostId,
        joinToken: res.hostJoinToken,
        hostToken: res.hostToken,
        storedAt: Date.now(),
      });
      navigateFn({ kind: 'wait', code: res.code });
    } catch (err) {
      const msg =
        err instanceof RoomApiError
          ? err.code === 'invalid_request'
            ? err.details ?? '请求无效'
            : err.code === 'code_generation_exhausted'
              ? '系统暂时繁忙，请稍后再试'
              : (err.details ?? err.code)
          : '创建失败 — 请检查网络';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="create">
      <header className="lobby-nav">
        <div className="lobby-nav__back">
          <button
            type="button"
            className="lobby-nav__back-btn"
            onClick={() => navigateFn({ kind: 'landing' })}
            aria-label="返回"
          >
            ← 返回
          </button>
          <span className="lobby-nav__title">创建房间</span>
        </div>
        <span className="lobby-nav__me-handle">{handle ?? ''}</span>
      </header>

      <div className="create__body">
        <section className="create__left">
          <div className="create__section">
            <div className="create__section-head">模式</div>
            <div className="seg" role="radiogroup" aria-label="模式">
              <ModeSegButton
                value="4"
                label="人对家"
                current={mode}
                onSelect={setMode}
              />
              <ModeSegButton
                value="6"
                label="人三家"
                current={mode}
                onSelect={setMode}
              />
              <ModeSegButton
                value="8"
                label="人四家"
                current={mode}
                onSelect={setMode}
              />
            </div>
          </div>

          <div className="create__section">
            <div className="create__section-head">
              AI 填空（{seatCount} 人位 · 房主已就位 · {seatCount - 1} 空位）
            </div>
            {aiSeats.map((seat) => (
              <div key={seat} className="create__ai-row">
                <span className="create__ai-slot">座位 {seat + 1}</span>
                <div className="create__ai-tier" role="radiogroup" aria-label={`座位 ${seat + 1} 难度`}>
                  {AI_TIERS.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      className={`chip ${(aiTiers[seat] ?? 'human') === tier ? 'chip--accent' : ''}`}
                      onClick={() => setSeatTier(seat, tier)}
                      aria-pressed={(aiTiers[seat] ?? 'human') === tier}
                    >
                      {AI_TIER_LABELS[tier]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="create__section">
            <div className="create__section-head">规则切片</div>
            <div className="create__rules">
              {RULE_AXES.map((axis) => (
                <button
                  key={axis.id}
                  type="button"
                  className={`create__rule ${rulesOn[axis.id] ? 'create__rule--active' : ''}`}
                  onClick={() => toggleRule(axis.id)}
                  aria-pressed={rulesOn[axis.id] ?? false}
                  aria-label={axis.label}
                >
                  <span className="create__rule-check" />
                  <span className="create__rule-label">{axis.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="create__right">
          <div className="create__preview-title">spec 预览</div>
          <div className="create__code-box">
            <div className="create__code-label">room code</div>
            <div className="create__code mono">- - - - - -</div>
          </div>
          <div className="create__summary-list">
            <SummaryRow k="模式" v={`${seatCount}P · ${teamDescriptor(mode)}`} />
            <SummaryRow k="A 级" v={rulesOn.aLevelStrict ? '严格' : '宽松'} />
            <SummaryRow k="通配" v={rulesOn.wildcardHeart ? '红心级牌 ON' : 'OFF'} />
            <SummaryRow k="报警" v={rulesOn.lastCallDeclare ? 'ON' : 'OFF'} />
            <SummaryRow k="炸弹" v="4 < 5 < 同花顺 < 6 < 7…" />
            <SummaryRow k="主持" v={handle ?? '未登录'} />
          </div>
          {error ? <p className="modal__error">{error}</p> : null}
          <button
            type="button"
            className="btn btn--primary btn--lg create__action"
            onClick={submit}
            disabled={busy || !handle}
          >
            {busy ? '创建中…' : '建立房间 →'}
          </button>
        </section>
      </div>
    </div>
  );
}

function ModeSegButton({
  value,
  label,
  current,
  onSelect,
}: {
  value: GameMode;
  label: string;
  current: GameMode;
  onSelect: (m: GameMode) => void;
}): React.JSX.Element {
  const active = current === value;
  return (
    <button
      type="button"
      className={`seg-btn ${active ? 'seg-btn--active' : ''}`}
      onClick={() => onSelect(value)}
      role="radio"
      aria-checked={active}
      aria-label={`${value} 人模式`}
    >
      <em>{value}</em>
      {label}
    </button>
  );
}

function SummaryRow({ k, v }: { k: string; v: string }): React.JSX.Element {
  return (
    <div className="create__summary-row">
      <span className="create__summary-key">{k}</span>
      <span className="create__summary-val">{v}</span>
    </div>
  );
}

function teamDescriptor(mode: GameMode): string {
  switch (mode) {
    case '4':
      return '对家';
    case '6':
      return '三家';
    case '8':
      return '四家';
  }
}
