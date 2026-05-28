// HostIPWarning — host-only chip flagging players that may share a network. (SEC-2)
//
// Rendered in the Waiting lobby for the host. Given the shared-IP groups
// computed server-side by lib/room/ipWarning.ts findSharedIpGroups (surfaced
// host-only on the room view), it shows one warning row per colliding group:
//   ⚠ 2 名玩家可能来自同一网络: @a, @b
//
// This is advisory, not a block — shared NAT (家庭 / 公司 / 网吧) legitimately
// collides, so the copy says "可能" (may). Renders nothing when there are no
// groups, so the host sees it ONLY when there's an actual collision. Self-
// contained classNames (host-ip-warning*) so no shared CSS is required for the
// component to function; styling is additive.

export interface HostIPWarningGroup {
  /** Opaque salted IP hash; used only as a stable React key. Never a raw IP. */
  readonly ipHash: string;
  /** Handles of the players sharing this network (≥2). */
  readonly handles: ReadonlyArray<string>;
}

export interface HostIPWarningProps {
  /** Shared-IP groups from findSharedIpGroups (host-only). */
  groups: ReadonlyArray<HostIPWarningGroup>;
}

export function HostIPWarning({ groups }: HostIPWarningProps): React.JSX.Element | null {
  // Hidden when there's nothing to warn about — no empty container, no
  // dangling heading.
  if (groups.length === 0) return null;

  return (
    <div
      className="host-ip-warning"
      role="status"
      aria-label="同一网络提示"
    >
      {groups.map((group) => (
        <p key={group.ipHash} className="host-ip-warning__row">
          <span className="host-ip-warning__icon" aria-hidden="true">
            ⚠
          </span>
          <span className="host-ip-warning__text">
            {group.handles.length} 名玩家可能来自同一网络：
            {group.handles.join('、')}
          </span>
        </p>
      ))}
    </div>
  );
}
