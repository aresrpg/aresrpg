// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SPAWN WANDER — a mob standing perfectly still reads as scenery, so each member of a group
// ambles a little around the spot it spawned on. Pure state → state, like pet_follow.ts: no
// three, no DOM, no clock of its own, so it is unit-testable headless and the renderer only
// draws what it returns.
//
// THE LEASH IS THE ANCHOR. Every waypoint orbits the member's OWN spawn point, never its current
// position, so a member can never random-walk away from its group: |position − anchor| stays
// inside WAYPOINT_R forever, with no correcting force and no drift to clamp. That anchoring is
// what keeps the chain's group position and the rendered pack the same place — the engage door
// proves the walk against the GROUP's chain coordinates, so a pack that wandered off would let
// a player press attack on mobs standing somewhere the transaction will refuse.
//
// Each member decides on its own seeded schedule, so a group is out of phase: some graze, some
// stand. The seed is the group index and the member ordinal, so a reload never teleports a pack.

/** Idle hold before the next decision, seconds — randomised per member, per decision. */
const IDLE_MIN_S = 2
const IDLE_MAX_S = 8
/** How long a walk decision lasts before the member reconsiders. */
const WALK_MIN_S = 1.5
const WALK_MAX_S = 4
/** Odds a decision starts a walk rather than holding — about half a group ambles at any moment. */
const WALK_CHANCE = 0.5
/** The amble radius around the anchor: a few blocks, never a migration. */
const WAYPOINT_R = 3.5
/** A gentle graze pace in blocks/second — fast enough to read as alive, slow enough to look calm. */
export const WANDER_SPEED = 0.9
/** Within this distance the waypoint counts as reached and the member settles to idle. */
const ARRIVE_EPS = 0.03

export const group_label_anchor = (
  members: readonly Readonly<{ x: number; y: number; z: number; height?: number | null }>[]
): Readonly<{ x: number; y: number; z: number }> | null => {
  if (members.length === 0) return null
  const totals = members.reduce(
    (sum, member) => ({
      x: sum.x + member.x,
      z: sum.z + member.z,
      y: Math.max(sum.y, member.y + (member.height ?? 2)),
    }),
    { x: 0, y: Number.NEGATIVE_INFINITY, z: 0 }
  )
  return Object.freeze({ x: totals.x / members.length, y: totals.y + 0.2, z: totals.z / members.length })
}

export type WanderState = Readonly<{
  /** the spawn anchor — the leash centre, never reassigned */
  ax: number
  az: number
  /** where the member stands now */
  x: number
  z: number
  /** the waypoint it is walking toward (equal to the position while idling) */
  tx: number
  tz: number
  /** seconds until the next idle/walk decision */
  decide_s: number
  walking: boolean
  /** actually covering ground this tick — the renderer blends its walk clip on this */
  moving: boolean
  /** the direction it faces, radians */
  yaw: number
}>

/** A member's amble seed: stable across reloads, distinct within a group. */
export const wander_seed = (group_index: number, member_index: number): number =>
  (Math.imul(group_index + 1, 2_654_435_761) ^ Math.imul(member_index + 1, 2_246_822_519)) >>> 0

/**
 * Where the members of a group of `size` stand around its chain point — a snug ring, one body
 * at the centre when the group is alone. The ring is the wander anchor set, so it also bounds
 * how far the whole pack can ever spread.
 */
const ring_at = (size: number, phase: number): readonly Readonly<{ dx: number; dz: number; yaw: number }>[] => {
  const radius = size === 1 ? 0 : Math.min(2.6, 1.3 + 0.22 * size)
  return Array.from({ length: size }, (_, member) => {
    const angle = (member / size) * Math.PI * 2 + phase
    return Object.freeze({ dx: Math.sin(angle) * radius, dz: Math.cos(angle) * radius, yaw: angle + Math.PI })
  })
}

export const group_ring = (size: number): readonly Readonly<{ dx: number; dz: number; yaw: number }>[] =>
  ring_at(size, 0.7)

/** Keep the pack centred on chain truth, but turn its regular ring along the flattest local
 * contour. On terraced terrain this prevents an opposite member starting behind another ledge. */
export const seated_group_ring = (
  size: number,
  x: number,
  z: number,
  ground_height: (x: number, z: number) => number
): readonly Readonly<{ dx: number; dz: number; yaw: number }>[] => {
  if (size <= 1) return group_ring(size)
  const candidates = [
    group_ring(size),
    ...Array.from({ length: 16 }, (_, index) => ring_at(size, (index / 16) * ((Math.PI * 2) / size))),
  ]
  const height_span = (ring: readonly Readonly<{ dx: number; dz: number }>[]): number => {
    const heights = ring.map(({ dx, dz }) => ground_height(x + dx, z + dz))
    return Math.max(...heights) - Math.min(...heights)
  }
  return candidates.reduce((best, candidate) => (height_span(candidate) < height_span(best) ? candidate : best))
}

/** A member at rest on its anchor, with its first decision already staggered inside the cycle. */
export const start_wander = (
  anchor: Readonly<{ x: number; z: number; yaw: number }>,
  random: () => number
): WanderState =>
  Object.freeze({
    ax: anchor.x,
    az: anchor.z,
    x: anchor.x,
    z: anchor.z,
    tx: anchor.x,
    tz: anchor.z,
    // stagger the very first decision so a freshly placed pack does not step in unison
    decide_s: random() * IDLE_MAX_S,
    walking: false,
    moving: false,
    yaw: anchor.yaw,
  })

/**
 * Advance one member by `delta_seconds`. A decision either picks a fresh waypoint inside the
 * leash disk or holds; a walking member then takes a CONSTANT-speed step toward its waypoint,
 * clamped to what remains so it glides rather than overshooting. Both ends of every step lie in
 * the leash disk, so the straight segment between them does too.
 */
export const step_wander = (state: WanderState, delta_seconds: number, random: () => number): WanderState => {
  const due = state.decide_s - delta_seconds
  const decided =
    due > 0
      ? state
      : random() < WALK_CHANCE
        ? ((angle, reach) => ({
            ...state,
            // the waypoint orbits the ANCHOR, never the current position — this is the leash
            tx: state.ax + Math.cos(angle) * reach,
            tz: state.az + Math.sin(angle) * reach,
            walking: true,
            decide_s: WALK_MIN_S + random() * (WALK_MAX_S - WALK_MIN_S),
          }))(random() * Math.PI * 2, WAYPOINT_R * (0.4 + random() * 0.6))
        : {
            ...state,
            tx: state.x,
            tz: state.z,
            walking: false,
            decide_s: IDLE_MIN_S + random() * (IDLE_MAX_S - IDLE_MIN_S),
          }
  const next = due > 0 ? { ...decided, decide_s: due } : decided

  const dx = next.tx - next.x
  const dz = next.tz - next.z
  const distance = Math.hypot(dx, dz)
  if (!next.walking || distance <= ARRIVE_EPS) return Object.freeze({ ...next, moving: false })

  const step = Math.min(distance, WANDER_SPEED * delta_seconds)
  return Object.freeze({
    ...next,
    x: next.x + (dx / distance) * step,
    z: next.z + (dz / distance) * step,
    moving: true,
    yaw: Math.atan2(dx, dz),
  })
}
