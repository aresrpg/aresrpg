// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable fp-law/no-mutating-methods, functional/immutable-data -- canvas path construction mutates fresh local arrays before returning immutable geometry. */
// COMPASS MATH — pure bearing/format helpers for the top-strip compass (CompassStrip.tsx). One
// home for the angle conventions so the strip, its tests, and any future consumer never drift:
//   • World axes are the voxel scene's: +X = east, +Z = south → NORTH = -Z (the minimap's up).
//   • A compass BEARING is the angle of a world-XZ direction from north, clockwise: 0 = N, +π/2 = E.
//   • The camera rig's yaw points the camera FORWARD at (-sin yaw, -cos yaw) — so the camera's
//     compass heading is exactly -yaw.
// The strip shows a ±HALF_SPAN window centered on the heading; strip_x maps a relative bearing
// into 0..1 across it (null outside — a mark UNMOUNTS at the edge instead of sliding across on
// wraparound).

export const TWO_PI = Math.PI * 2

/** Half of the strip's visible angular span (±100° — 45°-spaced cardinals land ~22.5% apart). */
export const HALF_SPAN = (100 * Math.PI) / 180

/** Wrap any angle (radians) into [-π, π). */
export const wrap_pi = (a: number): number => ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI

/** Compass bearing of a world-XZ direction (dx, dz): 0 = north (-Z), +π/2 = east (+X). */
export const bearing_of = (dx: number, dz: number): number => Math.atan2(dx, -dz)

/** The camera's compass heading from its rig yaw (forward = (-sin yaw, -cos yaw)). */
export const camera_heading = (yaw: number): number => wrap_pi(-yaw)

/** Signed bearing of `target_bearing` relative to `heading`: 0 = dead ahead, + = to the right. */
export const relative_bearing = (target_bearing: number, heading: number): number => wrap_pi(target_bearing - heading)

/** Map a relative bearing to a 0..1 strip position (0.5 = center), or null outside the window. */
export const strip_x = (rel: number, half_span: number = HALF_SPAN): number | null =>
  Math.abs(rel) > half_span ? null : 0.5 + rel / (2 * half_span)

/** The 8 compass points the strip labels, by bearing. Majors (N/E/S/W) render bigger. */
export const CARDINALS = Object.freeze([
  { label: 'N', bearing: 0, major: true },
  { label: 'NE', bearing: Math.PI / 4, major: false },
  { label: 'E', bearing: Math.PI / 2, major: true },
  { label: 'SE', bearing: (3 * Math.PI) / 4, major: false },
  { label: 'S', bearing: Math.PI, major: true },
  { label: 'SW', bearing: (-3 * Math.PI) / 4, major: false },
  { label: 'W', bearing: -Math.PI / 2, major: true },
  { label: 'NW', bearing: -Math.PI / 4, major: false },
] as const)

/** Distance tier for the pip fade: near = full, mid/far shrink + dim. */
export const pip_tier = (dist: number): 'near' | 'mid' | 'far' => (dist < 80 ? 'near' : dist < 220 ? 'mid' : 'far')

// ── ZONE BOUNDARY MARKERS (answers "how do I reach the next zone") ──────────────────────────
// The current zone cell is an axis-aligned square, so from anywhere INSIDE it the nearest point
// on any one of its 4 edges is a straight cardinal walk — the bearings below are exactly the
// CARDINALS' majors, by construction of the world axes.

/** The 2nd-nearest edge only earns a marker when it's ALSO this close (world blocks). */
export const NEAR_EDGE_THRESHOLD = 96

export type ZoneEdge = Readonly<{ edge: 'n' | 'e' | 's' | 'w'; bearing: number; dist: number }>

/** Perpendicular distance + absolute bearing from a CLIENT-space position to the 4 boundaries
 *  of the zone cell (zx, zz) (chain-space key). `offset` is the chain→client translation
 *  (world_center on both axes). `dist` is negative outside the cell — never clamped. */
export const zone_edge_distances = (
  world_x: number,
  world_z: number,
  zx: number,
  zz: number,
  zone_size: number,
  offset: number
): readonly ZoneEdge[] => {
  const x_min = zx * zone_size - offset
  const z_min = zz * zone_size - offset
  return Object.freeze([
    { edge: 'n', bearing: 0, dist: world_z - z_min },
    { edge: 'e', bearing: Math.PI / 2, dist: x_min + zone_size - world_x },
    { edge: 's', bearing: Math.PI, dist: z_min + zone_size - world_z },
    { edge: 'w', bearing: -Math.PI / 2, dist: world_x - x_min },
  ] as const)
}

/** The single nearest edge, plus the 2nd only when it is also within `near_threshold` (the
 *  near-a-corner case). Deterministic: ties keep the fixed N/E/S/W input order. */
export const nearest_zone_edges = (
  world_x: number,
  world_z: number,
  zx: number,
  zz: number,
  zone_size: number,
  offset: number,
  near_threshold: number = NEAR_EDGE_THRESHOLD
): readonly ZoneEdge[] => {
  const [nearest, second] = [...zone_edge_distances(world_x, world_z, zx, zz, zone_size, offset)].sort(
    (a, b) => a.dist - b.dist
  )
  return second && second.dist <= near_threshold ? [nearest!, second] : [nearest!]
}

/** The chain-space zone key adjacent to (zx, zz) across `edge` — the "next zone" a boundary
 *  marker points at, for a discovered/undiscovered lookup against the zones the client holds. */
export const neighbor_zone_key = (
  zx: number,
  zz: number,
  edge: ZoneEdge['edge']
): Readonly<{ zx: number; zz: number }> =>
  edge === 'n'
    ? { zx, zz: zz - 1 }
    : edge === 's'
      ? { zx, zz: zz + 1 }
      : edge === 'e'
        ? { zx: zx + 1, zz }
        : { zx: zx - 1, zz }

// ── PIP DENSITY CONTROL (the density dial once turned the strip into "pip soup") — three pure
// passes in THIS order: cap to the nearest few of each kind, cluster near-identical bearings
// into one marker, thin labels to the closest few. Falloff stays pip_tier's job.

export type Pip = Readonly<{ kind: string; bearing: number; dist: number }> & Readonly<Record<string, unknown>>

/** Rendered-pip cap per spawn kind. */
export const PIP_CAP: Readonly<Record<string, number>> = Object.freeze({ mob: 5, resource: 5 })

/** Two pips within this many DEGREES of bearing merge into one clustered marker. */
export const CLUSTER_ANGLE_DEG = 2

/** Of the surviving pips, only the nearest this-many PER KIND keep a distance label. */
export const LABEL_CAP = 3

/** Keep only the nearest `caps[kind]` entries per kind — stable, ties keep input order. */
export const cap_nearest_pips = <T extends Pip>(
  pips: readonly T[],
  caps: Readonly<Record<string, number>> = PIP_CAP
): T[] => {
  const by_kind = new Map<string, T[]>()
  for (const pip of pips) {
    if (!by_kind.has(pip.kind)) by_kind.set(pip.kind, [])
    by_kind.get(pip.kind)!.push(pip)
  }
  const out: T[] = []
  for (const [kind, list] of by_kind)
    out.push(...[...list].sort((a, b) => a.dist - b.dist).slice(0, caps[kind] ?? list.length))
  return out
}

/** Merge pips within `angle_deg` of each other's bearing into one marker, per kind. The nearest
 *  member represents the cluster; `count` is how many folded in. Chains transitively and wraps
 *  the ±π seam. */
export const cluster_pips = <T extends Pip>(
  pips: readonly T[],
  angle_deg: number = CLUSTER_ANGLE_DEG
): (T & { count: number })[] => {
  const threshold = (angle_deg * Math.PI) / 180
  const by_kind = new Map<string, T[]>()
  for (const pip of pips) {
    if (!by_kind.has(pip.kind)) by_kind.set(pip.kind, [])
    by_kind.get(pip.kind)!.push(pip)
  }
  const out: (T & { count: number })[] = []
  for (const list of by_kind.values()) {
    const sorted = [...list].sort((a, b) => wrap_pi(a.bearing) - wrap_pi(b.bearing))
    const groups: { members: T[] }[] = []
    for (const pip of sorted) {
      const open = groups.at(-1)
      const previous = open?.members.at(-1)
      if (open && previous && Math.abs(wrap_pi(pip.bearing - previous.bearing)) <= threshold) open.members.push(pip)
      else groups.push({ members: [pip] })
    }
    // The ±π seam: the last group may wrap into the first (+179° and -179° are 2° apart).
    if (groups.length > 1) {
      const [first] = groups
      const last = groups.at(-1)!
      const [first_edge] = first!.members
      const last_edge = last.members.at(-1)!
      if (Math.abs(wrap_pi(first_edge!.bearing - last_edge.bearing)) <= threshold) {
        first!.members = [...last.members, ...first!.members]
        groups.pop()
      }
    }
    for (const group of groups) {
      const [nearest] = [...group.members].sort((a, b) => a.dist - b.dist)
      out.push({ ...nearest!, count: group.members.length })
    }
  }
  return out
}

/** Tags which pips keep a visible distance label: the nearest `label_cap` of EACH kind — the
 *  rest render dot-only. Same-order copy; never re-sorts the input. */
export const thin_pip_labels = <T extends Pip>(
  pips: readonly T[],
  label_cap: number = LABEL_CAP
): (T & { show_label: boolean })[] => {
  const ranked = pips.map((pip, index) => ({ pip, index })).sort((a, b) => a.pip.dist - b.pip.dist)
  const used = new Map<string, number>()
  const labeled = new Set<number>()
  for (const { pip, index } of ranked) {
    const count = used.get(pip.kind) ?? 0
    if (count < label_cap) {
      labeled.add(index)
      used.set(pip.kind, count + 1)
    }
  }
  return pips.map((pip, index) => ({ ...pip, show_label: labeled.has(index) }))
}
