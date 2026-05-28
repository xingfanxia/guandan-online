// Behavior tests for findSharedIpGroups (SEC-2).

import { describe, expect, it } from 'vitest';
import { findSharedIpGroups } from '@lib/room/ipWarning';
import type { RoomMember } from '@lib/room/lifecycle';

function member(
  id: string,
  handle: string,
  ipHash?: string
): RoomMember {
  return {
    id,
    handle,
    joinToken: `jt-${id}`,
    joinedAt: 0,
    status: 'connected',
    ...(ipHash !== undefined ? { ipHash } : {}),
  };
}

describe('findSharedIpGroups', () => {
  it('returns no groups when every member has a distinct ipHash', () => {
    const members = [
      member('p0', '@a', 'h1'),
      member('p1', '@b', 'h2'),
      member('p2', '@c', 'h3'),
    ];
    expect(findSharedIpGroups(members)).toEqual([]);
  });

  it('returns a group of 2 when two members share an ipHash', () => {
    const members = [
      member('p0', '@a', 'shared'),
      member('p1', '@b', 'shared'),
      member('p2', '@c', 'other'),
    ];
    expect(findSharedIpGroups(members)).toEqual([
      { ipHash: 'shared', handles: ['@a', '@b'] },
    ]);
  });

  it('includes all members of a group of 3+', () => {
    const members = [
      member('p0', '@a', 'nat'),
      member('p1', '@b', 'nat'),
      member('p2', '@c', 'nat'),
    ];
    expect(findSharedIpGroups(members)).toEqual([
      { ipHash: 'nat', handles: ['@a', '@b', '@c'] },
    ]);
  });

  it('returns multiple groups when there are multiple collisions', () => {
    const members = [
      member('p0', '@a', 'office'),
      member('p1', '@b', 'home'),
      member('p2', '@c', 'office'),
      member('p3', '@d', 'home'),
    ];
    expect(findSharedIpGroups(members)).toEqual([
      { ipHash: 'office', handles: ['@a', '@c'] },
      { ipHash: 'home', handles: ['@b', '@d'] },
    ]);
  });

  it('excludes singleton ipHashes', () => {
    const members = [
      member('p0', '@a', 'shared'),
      member('p1', '@b', 'shared'),
      member('p2', '@c', 'lonely'), // singleton — not a collision
    ];
    const groups = findSharedIpGroups(members);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ipHash).toBe('shared');
  });

  it('ignores members without an ipHash (bots / un-identifiable)', () => {
    const members = [
      member('p0', '@host', 'h1'),
      member('p1', '@bot-1'), // no ipHash → ignored
      member('p2', '@bot-2'), // no ipHash → ignored
    ];
    // The two no-ipHash bots must NOT be grouped together.
    expect(findSharedIpGroups(members)).toEqual([]);
  });

  it('does not let missing ipHashes collide with each other', () => {
    const members = [
      member('p0', '@a', 'shared'),
      member('p1', '@b', 'shared'),
      member('p2', '@c'), // undefined
      member('p3', '@d'), // undefined
    ];
    // Only the real shared group surfaces; the two undefined members are
    // "unknown", not a matching pair.
    expect(findSharedIpGroups(members)).toEqual([
      { ipHash: 'shared', handles: ['@a', '@b'] },
    ]);
  });

  it('preserves member order within a group', () => {
    const members = [
      member('p2', '@third', 'g'),
      member('p0', '@first', 'g'),
      member('p1', '@second', 'g'),
    ];
    expect(findSharedIpGroups(members)[0]!.handles).toEqual([
      '@third',
      '@first',
      '@second',
    ]);
  });

  it('returns [] for an empty member list', () => {
    expect(findSharedIpGroups([])).toEqual([]);
  });
});
