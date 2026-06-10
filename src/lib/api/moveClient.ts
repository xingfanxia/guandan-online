// Client side of POST /api/room/[code]/move — the single place that builds
// the move-command wire body.
//
// CONTRACT (lib/api/move.ts parseMoveBody): { moveId, command: { kind, ...,
// fromVersion } } — the command is NESTED. A flat spread used to live copied
// into both table screens and silently bricked every UI move with
// invalid_move (HTTP 200 + {ok:false}, response unread). Both screens now
// import this module, and tests/contract/move-wire.test.ts round-trips
// buildMoveBody through the server parser so the shape can never drift
// silently again.

import { RoomApiError } from '@/lib/api/rooms';
import type { MoveCommand } from '@lib/realtime/commands';

/** Human-readable reasons for the common move rejections. */
export const MOVE_ERROR_ZH: Record<string, string> = {
  invalid_move: '这手牌不合法',
  not_your_turn: '还没轮到你',
  version_conflict: '状态已更新，请重试',
  move_in_flight: '上一步还在处理中',
  rate_limited: '操作太快，稍等一下',
  internal_error: '服务器开小差了，请重试',
};

export interface MoveWireBody {
  moveId: string;
  command: MoveCommand;
}

/** Build the exact JSON body the move endpoint expects. */
export function buildMoveBody(cmd: MoveCommand, moveId?: string): MoveWireBody {
  return { moveId: moveId ?? crypto.randomUUID(), command: cmd };
}

/**
 * POST a move command. Throws RoomApiError on transport failure OR on an
 * {ok:false} rejection — the endpoint returns rejections as HTTP 200, and
 * swallowing them renders as a frozen table.
 */
export async function postCommand(
  roomId: string,
  joinToken: string,
  cmd: MoveCommand,
): Promise<void> {
  const url = `/api/room/${encodeURIComponent(roomId)}/move`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${joinToken}`,
    },
    body: JSON.stringify(buildMoveBody(cmd)),
  });
  let body: { ok?: boolean; error?: string; details?: string } | null = null;
  try {
    body = (await res.json()) as { ok?: boolean; error?: string; details?: string };
  } catch {
    body = null;
  }
  if (!res.ok || body?.ok === false) {
    const code = body?.error ?? `http_${res.status}`;
    const details = body?.details;
    throw new RoomApiError(
      res.status,
      code,
      details ? `${MOVE_ERROR_ZH[code] ?? code}（${details}）` : (MOVE_ERROR_ZH[code] ?? code),
    );
  }
}
