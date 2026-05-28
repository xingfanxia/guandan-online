// PlayerStatusBadge — tiny per-seat status chip.
//
// AI-4: surfaces a player's connection state next to their Avatar at the game
// table. Four visual states:
//   connected (live human)      → subtle dot, no label
//   disconnected (silent human) → 离线
//   bot takeover (代打)          → 代打 (进阶) — a dropped human's seat being
//                                  played by a bot; reclaimable on reconnect
//   genuine bot (host fill)     → BOT
//
// `isTakeover` distinguishes a bot that took over a disconnected human
// (status='bot' AND member.takenOverFrom set) from a host-added fill bot
// (status='bot', no takenOverFrom). The caller derives `isTakeover` from the
// RoomMember.takenOverFrom field.
//
// Self-contained classNames — `player-status-badge` + a `--<state>` modifier.
// CSS lives wherever the game-table styles are imported (see INTEGRATION NOTES
// for the assumed classes).

import type { PlayerStatus } from '../../lib/realtime/messages.js';

export interface PlayerStatusBadgeProps {
  status: PlayerStatus;
  /** True when this bot took over a disconnected human (vs a host-fill bot). */
  isTakeover?: boolean;
}

export function PlayerStatusBadge({
  status,
  isTakeover = false,
}: PlayerStatusBadgeProps): React.JSX.Element | null {
  if (status === 'connected') {
    // Subtle presence dot — no text. role="img" + label keeps it accessible.
    return (
      <span
        className="player-status-badge player-status-badge--connected"
        role="img"
        aria-label="在线"
      />
    );
  }

  if (status === 'disconnected') {
    return (
      <span className="player-status-badge player-status-badge--disconnected">
        离线
      </span>
    );
  }

  // status === 'bot'
  if (isTakeover) {
    return (
      <span className="player-status-badge player-status-badge--takeover">
        代打 (进阶)
      </span>
    );
  }
  return (
    <span className="player-status-badge player-status-badge--bot">BOT</span>
  );
}
