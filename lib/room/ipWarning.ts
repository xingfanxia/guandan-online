// Same-room IP-collision detector. (SEC-2)
//
// Pure helper over a room's members: groups them by the salted `ipHash`
// stamped at join time (lib/room/lifecycle.ts RoomMember.ipHash) and surfaces
// any group with ≥2 members. Two players sharing an ipHash is the collusion
// signal the host sees via the HostIPWarning chip — they're likely on the same
// network (same household, same office NAT) and may be one person on two
// devices, or a coordinating pair.
//
// This is a HEURISTIC, not proof: shared NAT (a dorm, a café, a corporate
// gateway) legitimately collides. The UI copy says "可能来自同一网络"
// (may be from the same network) for exactly this reason. It is host-only
// information and never enters the public room view.
//
// Members without an ipHash (bots — never stamped; or humans who joined
// before the field existed / from an un-identifiable request) are ignored: a
// missing ipHash is "unknown", not "matches the other unknowns".

import type { RoomMember } from './lifecycle.js';
import type { PlayerHandle } from '../realtime/messages.js';

export interface SharedIpGroup {
  /** The salted IP hash shared by this group. Opaque; never a raw IP. */
  readonly ipHash: string;
  /** Handles of the members sharing this ipHash (≥2). Insertion order. */
  readonly handles: PlayerHandle[];
}

/**
 * Group `members` by ipHash, returning only the groups with ≥2 members.
 * Members without an ipHash are excluded entirely. Each returned group lists
 * the handles in member order; groups are returned in first-seen ipHash order
 * so the output is deterministic for a given member list.
 */
export function findSharedIpGroups(
  members: ReadonlyArray<RoomMember>
): SharedIpGroup[] {
  // Preserve first-seen order of ipHashes via an ordered key list alongside
  // the map, so callers (and tests) get a stable ordering.
  const byHash = new Map<string, PlayerHandle[]>();
  const order: string[] = [];

  for (const member of members) {
    const { ipHash } = member;
    if (!ipHash) continue; // bots + un-identifiable members are "unknown".
    const existing = byHash.get(ipHash);
    if (existing) {
      existing.push(member.handle);
    } else {
      byHash.set(ipHash, [member.handle]);
      order.push(ipHash);
    }
  }

  const groups: SharedIpGroup[] = [];
  for (const ipHash of order) {
    const handles = byHash.get(ipHash)!;
    if (handles.length >= 2) {
      groups.push({ ipHash, handles });
    }
  }
  return groups;
}
