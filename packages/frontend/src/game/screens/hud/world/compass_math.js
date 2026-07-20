// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COMPASS MATH — pure bearing/format helpers for the 3A top-strip compass (CompassStrip.jsx). One home
// for the angle conventions so the strip, its tests, and any future consumer can never drift:
//   • World axes are the voxel scene's: +X = east, +Z = south → NORTH = -Z (the minimap's up).
//   • A compass BEARING is the angle of a world-XZ direction from north, clockwise: 0 = N, +π/2 = E.
//   • The camera rig's yaw (embed_voxel `cam.get_yaw()`, walk_mode basis) points the camera FORWARD at
//     (-sin yaw, -cos yaw) — so the camera's compass heading is exactly -yaw (proven in the tests).
// The strip shows a ±HALF_SPAN window centered on the heading; strip_x maps a relative bearing into
// 0..1 across it (null outside — a mark UNMOUNTS at the edge instead of sliding across on wraparound).

import { zone_discovered } from '@aresrpg/world'

export const TWO_PI = Math.PI * 2

/** Half of the strip's visible angular span (±100° — 45°-spaced cardinals land ~22.5% apart). */
export const HALF_SPAN = (100 * Math.PI) / 180

/** Wrap any angle (radians) into [-π, π). */
export function wrap_pi(a) {
  return ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI
}

/** Compass bearing of a world-XZ direction (dx, dz): 0 = north (-Z), +π/2 = east (+X). */
export function bearing_of(dx, dz) {
  return Math.atan2(dx, -dz)
}

/** The camera's compass heading from its rig yaw (forward = (-sin yaw, -cos yaw)). */
export function camera_heading(yaw) {
  return wrap_pi(-yaw)
}

/** Signed bearing of `target_bearing` relative to `heading`, wrapped: 0 = dead ahead, + = to the right. */
export function relative_bearing(target_bearing, heading) {
  return wrap_pi(target_bearing - heading)
}

/** Map a relative bearing to a 0..1 strip position (0.5 = center), or null when outside the window. */
export function strip_x(rel, half_span = HALF_SPAN) {
  if (Math.abs(rel) > half_span) return null
  return 0.5 + rel / (2 * half_span)
}

/**
 * Countdown as "m:ss" (total minutes, unpadded — a 2 h zone TTL reads "120:00", monotonic and
 * unambiguous). Clamps at "0:00"; never renders a negative.
 */
export function format_mmss(ms) {
  const total_s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total_s / 60)
  const s = total_s % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** The 8 compass points the strip labels, by bearing. Majors (N/E/S/W) render bigger than inters. */
export const CARDINALS = [
  { label: 'N', bearing: 0, major: true },
  { label: 'NE', bearing: Math.PI / 4, major: false },
  { label: 'E', bearing: Math.PI / 2, major: true },
  { label: 'SE', bearing: (3 * Math.PI) / 4, major: false },
  { label: 'S', bearing: Math.PI, major: true },
  { label: 'SW', bearing: (-3 * Math.PI) / 4, major: false },
  { label: 'W', bearing: -Math.PI / 2, major: true },
  { label: 'NW', bearing: -Math.PI / 4, major: false },
]

/** Distance tier for the mockup's pip fade: near = full, mid/far shrink + dim. */
export function pip_tier(dist) {
  if (dist < 80) return 'near'
  if (dist < 220) return 'mid'
  return 'far'
}

// ── ZONE READINESS: the predicate trio (zone_discovered / reroll_at / zone_searchable) moved to its ONE
// home — @aresrpg/world (D770a W2: the spawns core's search_intent gate IS the rule). The compass countdown
// and the DiscoveryPrompts [F] arm import it from the package; zone_reconciled below shares it too.

// ── RECEIPT vs POLL (UX-latency fix — the compass stayed on UNSEARCHED far too long after the search
// was revealed): the compass's own /v1 poll (zones_view, 6s cadence) was the SOLE source for "is the
// current cell discovered", so it always waited out the indexer even though the search tx's OWN receipt
// already flipped the cell inside the shared spawns/zones core the instant it certified (spawns_zones.js's
// fold_zone_searched, read back via zone_row_of, @aresrpg/world). Pipeline law №1: predict off the receipt
// the client already proved; the poll only reconciles later and never regresses it — whichever row proves
// the LATER discovery wins (a fresh receipt beats a stale pre-search RPC row; an RPC row that has since
// caught up, or moved further on a second player's search, wins once it is actually newer).

/**
 * @param {{discovered:true, discovered_at_ms:number}|null} store_row the receipt-instant core projection
 *   (zone_row_of over the spawns/zones store's `zones` map)
 * @param {{discovered?:boolean, discovered_at_ms?:number|null}|null} rpc_row the compass's own polled /v1 row
 * @returns {any|null} whichever row proves the later discovery; null when neither proves one
 */
export function reconciled_zone_row(store_row, rpc_row) {
  const rpc_discovered = !!rpc_row && rpc_row.discovered !== false
  if (!store_row) return rpc_discovered ? rpc_row : null
  if (!rpc_discovered) return store_row
  return (rpc_row.discovered_at_ms ?? 0) > store_row.discovered_at_ms ? rpc_row : store_row
}

// ── SEARCH-SUCCESS RECONCILE (UX-latency fix — the compass took a bit of time to update after
// searching a zone): the tx confirms fast, but the indexer needs 1-2 checkpoints (~1-3s) to project the
// fresh Zone DF snapshot, and the strip's zones/spawns reads otherwise sit on their own blind 6s poll
// cadence with no idea a search just landed. The bounded retry-until-changed policy (CompassStrip.jsx wires
// it to the player's OWN `discovery/zone_searched` broadcast) lives HERE so the give-up budget and the
// "did it actually change" test are ONE tested home, never a magic number re-guessed at the call site.

/** Tries the compass spends waiting for ITS OWN search to reconcile before giving up silently to the
 * normal 6s poll (fast enough to feel instant, bounded so a wedged indexer can never hang
 * the strip). */
export const ZONE_REFRESH_TRIES = 4
/** Spacing between tries — total worst-case wait is `ZONE_REFRESH_TRIES * ZONE_REFRESH_INTERVAL_MS` (3.2s). */
export const ZONE_REFRESH_INTERVAL_MS = 800

/**
 * True once a FRESH read of the searched zone shows `discovered_at_ms` moved past `prior_at_ms` — the ONE
 * test for "this zone's search has reconciled into the read layer." `search_internal` always stamps a NEW,
 * monotonically increasing `now` (clock.timestamp_ms()) on every successful search/re-search, so ANY change
 * off the pre-search baseline is real reconciliation, never a false positive from re-fetching unchanged
 * data. `prior_at_ms` null (the zone had never been discovered before this search) reconciles the instant
 * the row exists at all.
 * @param {any} zone_row a FRESH (cache-bypassed) read of the searched zone, or null
 * @param {number|null} prior_at_ms the zone's `discovered_at_ms` immediately before this search (or null)
 */
export function zone_reconciled(zone_row, prior_at_ms) {
  if (!zone_discovered(zone_row)) return false
  const at = zone_row.discovered_at_ms ?? null
  return at != null && at !== prior_at_ms
}

// ── ZONE BOUNDARY MARKERS (answers "how do I reach the next zone") ───────────────────────────
// The current zone cell is an axis-aligned zone_size × zone_size square, so from anywhere INSIDE it the
// nearest point on any one of its 4 edges is a straight cardinal walk, never a diagonal — the bearings
// below are exactly the CARDINALS' N/E/S/W majors, by construction of the world axes (bearing_of above).

/** The 2nd-nearest edge only earns a marker when it's ALSO this close (world blocks) — i.e. near a zone
 * corner, where two boundaries are close at once. Tuned to ~96 blocks. */
export const NEAR_EDGE_THRESHOLD = 96

/**
 * Perpendicular distance + absolute compass bearing from a world-space position to each of the 4
 * boundaries of the zone cell `(zx, zy)` (CHAIN-space key, e.g. from `zone_of_world`). Pure geometry, no
 * notion of "current" beyond the key passed in — `dist` is negative if `(world_x, world_z)` is actually
 * outside the cell (never clamped, so a caller can detect that instead of silently lying).
 * @param {number} world_x @param {number} world_z position expected inside the cell (signed world space)
 * @param {number} zx @param {number} zy the cell's CHAIN-space zone key
 * @param {number} zone_size @param {number} offset_x @param {number} offset_z per-axis world_offsets(world_doc)
 * @returns {{ edge: 'n'|'e'|'s'|'w', bearing: number, dist: number }[]} always the 4 edges, N/E/S/W order
 */
export function zone_edge_distances(world_x, world_z, zx, zy, zone_size, offset_x, offset_z) {
  const x_min = zx * zone_size - offset_x
  const z_min = zy * zone_size - offset_z
  const x_max = x_min + zone_size
  const z_max = z_min + zone_size
  return [
    { edge: 'n', bearing: 0, dist: world_z - z_min },
    { edge: 'e', bearing: Math.PI / 2, dist: x_max - world_x },
    { edge: 's', bearing: Math.PI, dist: z_max - world_z },
    { edge: 'w', bearing: -Math.PI / 2, dist: world_x - x_min },
  ]
}

/**
 * Which edge(s) of the current zone earn a compass marker: always the single nearest, plus the
 * 2nd-nearest ONLY when it's also within `near_threshold` blocks (the near-a-corner case, where two
 * edges are close at once). Sorted nearest-first; exact ties break on the fixed N/E/S/W input order
 * (stable sort) — deterministic, never a flicker between two equidistant edges.
 * @returns {{ edge: 'n'|'e'|'s'|'w', bearing: number, dist: number }[]} 1 or 2 entries
 */
export function nearest_zone_edges(
  world_x,
  world_z,
  zx,
  zy,
  zone_size,
  offset_x,
  offset_z,
  near_threshold = NEAR_EDGE_THRESHOLD
) {
  const [nearest, second] = zone_edge_distances(world_x, world_z, zx, zy, zone_size, offset_x, offset_z).sort(
    (a, b) => a.dist - b.dist
  )
  return second && second.dist <= near_threshold ? [nearest, second] : [nearest]
}

/** The CHAIN-space zone key adjacent to `(zx, zy)` across `edge` — the "next zone" a boundary marker
 * points at, for a cheap discovered/undiscovered lookup against the same zones store the strip already
 * reads (no new fetch). Purely mechanical: a neighbor past the world's low edge (zx/zy going negative)
 * simply won't match any row in that store, which reads as "undiscovered" — an honest default, not a crash. */
export function neighbor_zone_key(zx, zy, edge) {
  if (edge === 'n') return { zx, zy: zy - 1 }
  if (edge === 's') return { zx, zy: zy + 1 }
  if (edge === 'e') return { zx: zx + 1, zy }
  return { zx: zx - 1, zy } // 'w'
}

// ── PIP DENSITY CONTROL (the density dial, 12-24 groups + 16-28 nodes/zone, turned the
// strip into "pip soup": ~40 overlapping dots + stacked labels, unreadable). Three pure passes, applied in
// THIS order (CompassStrip renders whatever survives): cap to the nearest few of each kind, cluster
// near-identical bearings into one marker, thin labels to the closest few. Size/opacity falloff was
// already `pip_tier`'s job (near/mid/far, CSS-driven) — reapplied unchanged to
// whatever's left, no new mechanism needed. Distance stays the existing 2D `Math.hypot(dx, dz)` (spawn
// rows carry only x/z — the zone derivation (zone_rows.js) has no altitude — so there's no 3rd axis to add).

/** Rendered-pip cap per spawn kind (tunable — default ~5). */
export const PIP_CAP = { mob: 5, resource: 5 }

/** Two pips within this many DEGREES of bearing merge into one clustered marker. */
export const CLUSTER_ANGLE_DEG = 2

/** Of the surviving pips, only the nearest this-many PER KIND keep a visible distance label (the rest are
 * dot-only) — mirrors PIP_CAP's per-kind shape, so "resources are pollution-free" can't starve mobs' labels. */
export const LABEL_CAP = 3

/**
 * Keep only the nearest `caps[kind]` entries of `pips`, independently per kind — everything past that is
 * exactly the "pollution" this control removes. Stable-sorts by `dist` ascending; ties keep input order.
 * @param {{kind:string, dist:number}[]} pips
 * @param {Record<string, number>} caps
 */
export function cap_nearest_pips(pips, caps = PIP_CAP) {
  const by_kind = new Map()
  for (const p of pips) {
    if (!by_kind.has(p.kind)) by_kind.set(p.kind, [])
    by_kind.get(p.kind).push(p)
  }
  const out = []
  for (const [kind, list] of by_kind) {
    const n = caps[kind] ?? list.length
    out.push(
      ...list
        .slice()
        .sort((a, b) => a.dist - b.dist)
        .slice(0, n)
    )
  }
  return out
}

/**
 * Merge pips within `angle_deg` of each other's absolute BEARING into one marker, per kind (mob and
 * resource dots never merge into each other — kind IS the marker style). The nearest member represents the
 * cluster (its own id/x/dist/title survive the merge); `count` is how many raw pips folded in (1 = alone).
 * Chains transitively (A↔B and B↔C close merges all three even when A↔C alone would not) and wraps the ±π
 * seam so two pips at e.g. +179° and -179° (2° apart the short way) still merge.
 * @param {{kind:string, bearing:number, dist:number}[]} pips
 * @param {number} angle_deg
 * @returns {(object & { count: number })[]}
 */
export function cluster_pips(pips, angle_deg = CLUSTER_ANGLE_DEG) {
  const threshold = (angle_deg * Math.PI) / 180
  const by_kind = new Map()
  for (const p of pips) {
    if (!by_kind.has(p.kind)) by_kind.set(p.kind, [])
    by_kind.get(p.kind).push(p)
  }
  const out = []
  for (const list of by_kind.values()) {
    const sorted = list.slice().sort((a, b) => wrap_pi(a.bearing) - wrap_pi(b.bearing))
    const groups = []
    for (const p of sorted) {
      const open = groups[groups.length - 1]
      const prev = open?.members[open.members.length - 1]
      if (open && Math.abs(wrap_pi(p.bearing - prev.bearing)) <= threshold) open.members.push(p)
      else groups.push({ members: [p] })
    }
    // The ±π seam: the last group may wrap into the first (e.g. bearings at +179° and -179°, 2° apart).
    if (groups.length > 1) {
      const [first] = groups
      const last = groups[groups.length - 1]
      const [first_edge] = first.members
      const last_edge = last.members[last.members.length - 1]
      if (Math.abs(wrap_pi(first_edge.bearing - last_edge.bearing)) <= threshold) {
        first.members = [...last.members, ...first.members]
        groups.pop()
      }
    }
    for (const g of groups) {
      const [nearest] = g.members.slice().sort((a, b) => a.dist - b.dist)
      out.push({ ...nearest, count: g.members.length })
    }
  }
  return out
}

/**
 * Tags which of `pips` keep a visible distance label: the nearest `label_cap` of EACH kind — the rest
 * render dot-only. Returns a same-order copy (never re-sorts the input) with `show_label` attached; the
 * ranking itself is by `dist`, computed on a throwaway copy.
 * @param {{kind:string, dist:number}[]} pips
 * @param {number} label_cap
 * @returns {(object & { show_label: boolean })[]}
 */
export function thin_pip_labels(pips, label_cap = LABEL_CAP) {
  const ranked = pips.map((p, i) => ({ p, i })).sort((a, b) => a.p.dist - b.p.dist)
  const used = new Map() // kind -> labels assigned so far
  const labeled = new Set() // original indices that keep a label
  for (const { p, i } of ranked) {
    const n = used.get(p.kind) ?? 0
    if (n < label_cap) {
      labeled.add(i)
      used.set(p.kind, n + 1)
    }
  }
  return pips.map((p, i) => ({ ...p, show_label: labeled.has(i) }))
}
