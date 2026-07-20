// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZONE DERIVE — the client mirror of the chain's SEED-DERIVED zone composition (search-cost rework, owner
// 2026-07-13 "good search design"). A discovered zone stores ONLY its composition SEED + consumed-BITMAPS on
// chain (never the spawn rows — the searcher no longer pays storage whose rebate leaks to other players); the
// exact group/cell lists DERIVE from the seed. This module is the byte-for-byte twin of
// `aresrpg_foundation::zone_gen` (zone_gen.move) so the overworld map advertises EXACTLY what the on-chain
// fight/gather doors materialise (composition-at-discovery). SPAWN SPACING (minimum distance of
// 20 blocks between each spawn of mobs) is enforced HERE in the position derivation — the same deterministic
// rejection sampling the chain runs, so client and chain agree on every position.
//
// DETERMINISM IS LAW (@aresrpg/sim): only `prng.js` (mulberry32) is the randomness source — the SAME PRNG the
// Move `prng` module ports. No Math.random, no floats in the draw path. spawn_id is a full 64-bit value (two u32
// draws) carried as a BigInt / decimal string (it exceeds 2^53 — Number would corrupt it).

import { rng_seed, rng_next, rng_range, mix } from './prng.js'

const MOB_SALT = 0x4d4f_425f // sub-seed decorrelation for the mob stream — MUST equal zone_gen.move MOB_SALT
const RES_SALT = 0x5245_535f // sub-seed decorrelation for the resource stream — MUST equal zone_gen.move RES_SALT
const MAX_GATHER_JOB = 2 // SPEC §6: FARMER/HERBALIST/MINER entries grow FIELDS; job above = single cell
const CLUSTER_CAP = 20 // hard rail on cells per gather field (zone_gen.move twin)
const MIN_SPAWN_SPACING = 20 // mob group spawns pairwise ≥ 20 blocks apart
const SPACING_D2 = MIN_SPAWN_SPACING * MIN_SPAWN_SPACING // squared compare (= 400)
const POS_ATTEMPTS = 64 // rejection cap; on exhaustion accept the last roll (a zone too small to fit the spacing)

/** prng-state twin of `zone_gen::p_roll_u64` — SKIP the draw when `lo >= hi` (point/malformed band). */
const p_roll_u64 = (state, lo, hi) => (lo >= hi ? { state, value: lo } : rng_range(state, lo, hi))

/** prng-state twin of `zone_gen::p_pick_weighted` — ALWAYS draws once; `null` on an empty/all-zero table. */
const p_pick_weighted = (state, weights) => {
  const n = weights.length
  if (n === 0) return { state, idx: null }
  let total = 0
  for (let i = 0; i < n; i++) total += weights[i]
  if (total === 0) return { state, idx: null }
  const { state: s1, value: roll } = rng_range(state, 0, total - 1)
  let acc = 0
  for (let j = 0; j < n; j++) {
    acc += weights[j]
    if (roll < acc) return { state: s1, idx: j }
  }
  return { state: s1, idx: n - 1 }
}

/** prng-state twin of `zone_gen::p_roll_pos` — two draws inside the zone box, clamped in-bounds. */
const p_roll_pos = (state, ox, oz, zsize, bx, bz) => {
  const r1 = p_roll_u64(state, 0, zsize - 1)
  const r2 = p_roll_u64(r1.state, 0, zsize - 1)
  let x = ox + r1.value
  let z = oz + r2.value
  if (x >= bx) x = bx - 1
  if (z >= bz) z = bz - 1
  return { state: r2.state, x, z }
}

/** `true` iff `(x, z)` is ≥ MIN_SPAWN_SPACING (squared) from every already-placed group. */
const far_enough = (xs, zs, x, z) => {
  for (let i = 0; i < xs.length; i++) {
    const dx = Math.abs(x - xs[i])
    const dz = Math.abs(z - zs[i])
    if (dx * dx + dz * dz < SPACING_D2) return false
  }
  return true
}

/** Rejection-sample a position that clears the 20-block spacing — twin of `zone_gen::p_roll_pos_spaced`. */
const p_roll_pos_spaced = (state, xs, zs, ox, oz, zsize, bx, bz) => {
  let s = state
  let fx = 0
  let fz = 0
  for (let attempt = 0; attempt < POS_ATTEMPTS; attempt++) {
    const r = p_roll_pos(s, ox, oz, zsize, bx, bz)
    s = r.state
    fx = r.x
    fz = r.z
    if (far_enough(xs, zs, r.x, r.z)) return { state: s, x: r.x, z: r.z }
  }
  return { state: s, x: fx, z: fz }
}

/** Clamp a rolled group size to `[1, size_bound]` — twin of `world_math::clamp_group_u16`. */
const clamp_group = (v, bound) => {
  const capped = v > bound ? bound : v
  return capped < 1 ? 1 : capped
}

/**
 * Derive a discovered zone's FULL mob-group list from its composition `seed` — the byte-for-byte mirror of
 * `zone_gen::derive_mob_groups`. `weights` / `min_group` / `max_group` are PARALLEL to the caller's mob template
 * table (distance-filtered by the caller, exactly as the chain does before calling). Returns one row per group in
 * STREAM ORDER (the bit index the on-chain mob-bitmap keys on). Positions are pairwise ≥ 20 blocks by
 * construction (the spawn-spacing law).
 * @param {object} p
 * @param {number|bigint} p.seed  the zone composition seed
 * @param {number} p.min_g @param {number} p.max_g  group-count band
 * @param {number[]} p.weights  distance-filtered rate_bp weights (parallel to the template table)
 * @param {number[]} p.min_group @param {number[]} p.max_group  per-row group-size bands
 * @param {number} p.size_bound  the §4 distance group-size cap
 * @param {number} p.ox @param {number} p.oz @param {number} p.zsize @param {number} p.bx @param {number} p.bz
 * @returns {Array<{ spawn_id: bigint, template_idx: number, x: number, z: number, size: number, group_seed: number }>}
 */
export function derive_mob_groups({
  seed,
  min_g,
  max_g,
  weights,
  min_group,
  max_group,
  size_bound,
  ox,
  oz,
  zsize,
  bx,
  bz,
}) {
  const out = []
  const xs = []
  const zs = []
  let s = rng_seed(mix(seed, MOB_SALT))
  const g = p_roll_u64(s, min_g, max_g)
  s = g.state
  for (let i = 0; i < g.value; i++) {
    const pick = p_pick_weighted(s, weights)
    s = pick.state
    if (pick.idx === null) break
    const idx = pick.idx
    const sz = p_roll_u64(s, min_group[idx], max_group[idx])
    s = sz.state
    const size = clamp_group(sz.value, size_bound)
    const pos = p_roll_pos_spaced(s, xs, zs, ox, oz, zsize, bx, bz)
    s = pos.state
    const gseed = rng_next(s)
    const hi = rng_next(gseed.state)
    const lo = rng_next(hi.state)
    s = lo.state
    const spawn_id = (BigInt(hi.value) << 32n) | BigInt(lo.value)
    out.push({ spawn_id, template_idx: idx, x: pos.x, z: pos.z, size, group_seed: gseed.value })
    xs.push(pos.x)
    zs.push(pos.z)
  }
  return out
}

/**
 * Derive a discovered zone's FULL resource-cell list from its `seed` — the byte-for-byte mirror of
 * `zone_gen::derive_resources`. A GATHER entry (job ≤ 2) grows a contiguous FIELD of `min(qty, 20)` cells; a
 * non-gather entry lands ONE cell. EVERY cell is one-harvest/one-bit (the multi-charge
 * `remaining` concept collapsed into the consumed-bitmap). One row per CELL in stream order (the res-bitmap index).
 * @param {object} p
 * @param {number|bigint} p.seed
 * @param {number} p.min_n @param {number} p.max_n  node-target band
 * @param {number[]} p.weights @param {number[]} p.min_qty @param {number[]} p.max_qty @param {number[]} p.jobs
 * @param {number} p.ox @param {number} p.oz @param {number} p.zsize @param {number} p.bx @param {number} p.bz
 * @returns {Array<{ spawn_id: bigint, template_idx: number, x: number, z: number }>}
 */
export function derive_resources({ seed, min_n, max_n, weights, min_qty, max_qty, jobs, ox, oz, zsize, bx, bz }) {
  const out = []
  let s = rng_seed(mix(seed, RES_SALT))
  const t = p_roll_u64(s, min_n, max_n)
  s = t.state
  const target_n = t.value
  // zone ∩ world inclusive box (a straddling last zone clamps in) — the field-growth confinement
  const max_cx = Math.min(ox + zsize - 1, bx - 1)
  const max_cz = Math.min(oz + zsize - 1, bz - 1)
  while (out.length < target_n) {
    const pick = p_pick_weighted(s, weights)
    s = pick.state
    if (pick.idx === null) break
    const idx = pick.idx
    const q = p_roll_u64(s, min_qty[idx], max_qty[idx])
    s = q.state
    const anchor = p_roll_pos(s, ox, oz, zsize, bx, bz)
    s = anchor.state
    const push_cell = (x, z) => {
      const hi = rng_next(s)
      const lo = rng_next(hi.state)
      s = lo.state
      out.push({ spawn_id: (BigInt(hi.value) << 32n) | BigInt(lo.value), template_idx: idx, x, z })
    }
    if (jobs[idx] <= MAX_GATHER_JOB) {
      const k = Math.min(q.value, CLUSTER_CAP)
      const grown = p_grow_cluster(s, anchor.x, anchor.z, k, ox, max_cx, oz, max_cz)
      s = grown.state
      for (let c = 0; c < grown.xs.length; c++) push_cell(grown.xs[c], grown.zs[c])
    } else {
      push_cell(anchor.x, anchor.z) // non-gather: ONE cell, one harvest (the one-bit collapse)
    }
  }
  return out
}

/** Hashed-Prim's field walk — twin of `zone_gen::p_grow_cluster` (one priority draw per offered cell). */
const p_grow_cluster = (state, ax, az, cap, min_x, max_x, min_z, max_z) => {
  const xs = [ax]
  const zs = [az]
  if (cap <= 1) return { state, xs, zs }
  let s = state
  const seen = new Set([`${ax}:${az}`])
  const fx = []
  const fz = []
  const fp = []
  const try_cell = (x, z) => {
    const key = `${x}:${z}`
    if (seen.has(key)) return
    const draw = rng_next(s)
    s = draw.state
    seen.add(key)
    fx.push(x)
    fz.push(z)
    fp.push(draw.value)
  }
  const offer = (cx, cz) => {
    if (cx < max_x) try_cell(cx + 1, cz)
    if (cx > min_x) try_cell(cx - 1, cz)
    if (cz < max_z) try_cell(cx, cz + 1)
    if (cz > min_z) try_cell(cx, cz - 1)
  }
  offer(ax, az)
  while (xs.length < cap && fx.length > 0) {
    let best = 0
    for (let i = 1; i < fp.length; i++) if (fp[i] < fp[best]) best = i
    const cx = fx[best]
    const cz = fz[best]
    // swap-remove (Move parity — order matters for the next best-scan)
    fx[best] = fx[fx.length - 1]
    fx.pop()
    fz[best] = fz[fz.length - 1]
    fz.pop()
    fp[best] = fp[fp.length - 1]
    fp.pop()
    xs.push(cx)
    zs.push(cz)
    offer(cx, cz)
  }
  return { state: s, xs, zs }
}

// ── §4 distance-difficulty pipeline (integer ports of world_math.move — the derivation INPUT filters) ──────────

const PROGRESS_SCALE = 1000
const DIST_EDGE = 5000
const DIST_A1 = 250
const DIST_A2 = 1000
const PROG_A1 = 91
const PROG_A2 = 818
const NEAR_GROUP_CAP = 2

/** Integer Newton sqrt — exact twin of world_math::isqrt (inputs < 2^53 stay exact in JS). */
const isqrt = n => {
  if (n < 2) return n
  let x = n
  let y = Math.floor((x + 1) / 2)
  while (y < x) {
    x = y
    y = Math.floor((x + Math.floor(n / x)) / 2)
  }
  return x
}

/** Twin of `world_math::distance_progress` — normalised difficulty ∈ [0, 1000] at zone point (ax,az). */
export const distance_progress = (ax, az, bx, bz) => {
  const dx = Math.abs(ax - bx)
  const dz = Math.abs(az - bz)
  const d2 = dx * dx + dz * dz
  if (d2 >= DIST_EDGE * DIST_EDGE) return PROGRESS_SCALE
  const d = isqrt(d2)
  if (d <= DIST_A1) return Math.floor((d * PROG_A1) / DIST_A1)
  if (d <= DIST_A2) return PROG_A1 + Math.floor(((d - DIST_A1) * (PROG_A2 - PROG_A1)) / (DIST_A2 - DIST_A1))
  return PROG_A2 + Math.floor(((d - DIST_A2) * (PROGRESS_SCALE - PROG_A2)) / (DIST_EDGE - DIST_A2))
}

const axis_gap = (a_min, a_max, b_min, b_max) => {
  if (a_max < b_min) return b_min - a_max
  if (b_max < a_min) return a_min - b_max
  return 0
}

/**
 * Distance progress from the centred first-join RECTANGLE to the searched zone rectangle — twin of
 * `zone_comp::spawn_distance_progress`. Every zone intersecting the legal join box is progress 0; the authored
 * continuous 250/1000/5000 curve begins at its boundary.
 */
export const spawn_distance_progress = ({
  ox,
  oz,
  zsize,
  bx,
  bz,
  spawn_x,
  spawn_z,
}) => {
  const spawn_min_x = Math.floor(bx / 2) - Math.floor(spawn_x / 2)
  const spawn_min_z = Math.floor(bz / 2) - Math.floor(spawn_z / 2)
  const spawn_max_x = spawn_min_x + spawn_x - 1
  const spawn_max_z = spawn_min_z + spawn_z - 1
  const zone_max_x = Math.min(ox + zsize - 1, bx - 1)
  const zone_max_z = Math.min(oz + zsize - 1, bz - 1)
  const dx = axis_gap(ox, zone_max_x, spawn_min_x, spawn_max_x)
  const dz = axis_gap(oz, zone_max_z, spawn_min_z, spawn_max_z)
  return distance_progress(dx, dz, 0, 0)
}

/** Twin of `world_math::level_cap`. */
export const level_cap = (progress, roster_min, roster_max) => {
  if (roster_max <= roster_min) return roster_min
  const span = roster_max - roster_min
  return roster_min + Math.floor((span * progress + PROGRESS_SCALE / 2) / PROGRESS_SCALE)
}

/** Twin of `world_math::size_cap`. */
export const size_cap = (progress, team_bound) => {
  const near = team_bound < NEAR_GROUP_CAP ? team_bound : NEAR_GROUP_CAP
  const span = team_bound - near
  return near + Math.floor((span * progress + PROGRESS_SCALE / 2) / PROGRESS_SCALE)
}

/** Twin of `world_math::roster_bounds` — (min authored non-zero level, max level) over the parallel levels. */
export const roster_bounds = levels => {
  let max = 0
  let min_auth = 0
  for (const lv of levels) {
    if (lv > max) max = lv
    if (lv > 0 && (min_auth === 0 || lv < min_auth)) min_auth = lv
  }
  return { min: min_auth, max }
}

// ── consumed-bitmap helpers (zones.move `bit_get` layout: byte i>>3, bit i&7) ──────────────────────────────────

/** Read bit `i` of a `vector<u8>` bitmap (short bitmaps read as 0 — lazily grown on chain). */
export const bit_get = (bitmap, i) => {
  const byte = bitmap?.[i >> 3] ?? 0
  return (byte >> (i & 7)) & 1
}

// ── the high-level client composer: (world doc + zone {seed, bitmaps}) → the legacy spawn-row shape ────────────

/**
 * Derive a searched zone's LIVE spawn rows — the drop-in replacement for reading the retired stored-row Zone.
 * Runs the chain's exact input pipeline (distance outside spawn zone → eligible weights + size cap), derives
 * via the kernel mirrors above, then filters CONSUMED entries by the zone's bitmaps. Rows carry the legacy shape
 * (`world_spawns.js` / `gather_actions.js` consume them unchanged) plus `index` — the derivation-stream bit index
 * the chain doors key on (`node_index` for gathers; stable across consumption, unlike the retired swap-remove
 * positional index). `spawn_id`/`group_seed` are DECIMAL STRINGS (64-bit — Number would corrupt them).
 * @param {object} p
 * @param {object} p.zone  `{ seed, discovered_at_ms, mob_bitmap: number[], res_bitmap: number[] }` — the Zone DF
 * @param {number} p.zx @param {number} p.zy  the zone key
 * @param {object} p.world  the World doc: `{ zone_size, bounds_x, bounds_z, min_groups, max_groups, min_nodes,
 *   max_nodes, mobs: Array<{template_id, rate_bp, min_group, max_group, level?}>,
 *   resources: Array<{template_id, rate_bp, min_qty, max_qty, job, tier}> }` (`level` = the distance-difficulty
 *   eligibility DF value, 0/absent = unauthored — the dormant path)
 * @param {number} [p.team_bound]  GameConfig team_size_bound (default 6 — config.move DEFAULT_TEAM_SIZE)
 * @returns {Array<{ spawn_id:string, kind:'mob'|'resource', index:number, x:number, z:number, template_id:string,
 *   size?:number, spawned_at_ms?:number, group_seed?:string, remaining?:number, job?:number, tier?:number }>}
 */
export function derive_zone({ zone, zx, zy, world, team_bound = 6 }) {
  const zsize = Number(world.zone_size)
  const bx = Number(world.bounds_x)
  const bz = Number(world.bounds_z)
  const ox = zx * zsize
  const oz = zy * zsize
  const mobs = world.mobs ?? []
  const resources = world.resources ?? []
  const seed = zone.seed
  const spawned_at_ms = Number(zone.discovered_at_ms ?? 0)

  // §4 distance-difficulty inputs — the EXACT chain pipeline (zones.move derive internals)
  const levels = mobs.map(m => Number(m.level ?? 0))
  const { min: rmin, max: rmax } = roster_bounds(levels)
  const progress = spawn_distance_progress({
    ox,
    oz,
    zsize,
    bx,
    bz,
    spawn_x: Number(world.spawn_zone_x ?? 1000),
    spawn_z: Number(world.spawn_zone_z ?? 1000),
  })
  const lvl_cap = level_cap(progress, rmin, rmax)
  const weights = mobs.map((m, i) => (levels[i] <= lvl_cap ? Number(m.rate_bp) : 0))
  const size_bound = size_cap(progress, Number(team_bound) || 6)

  const groups = derive_mob_groups({
    seed,
    min_g: Number(world.min_groups),
    max_g: Number(world.max_groups),
    weights,
    min_group: mobs.map(m => Number(m.min_group)),
    max_group: mobs.map(m => Number(m.max_group)),
    size_bound,
    ox,
    oz,
    zsize,
    bx,
    bz,
  })
  const cells = derive_resources({
    seed,
    min_n: Number(world.min_nodes),
    max_n: Number(world.max_nodes),
    weights: resources.map(r => Number(r.rate_bp)),
    min_qty: resources.map(r => Number(r.min_qty)),
    max_qty: resources.map(r => Number(r.max_qty)),
    jobs: resources.map(r => Number(r.job)),
    ox,
    oz,
    zsize,
    bx,
    bz,
  })

  const rows = []
  groups.forEach((g, i) => {
    if (bit_get(zone.mob_bitmap, i)) return // consumed — a fight already claimed this group
    rows.push({
      spawn_id: g.spawn_id.toString(),
      kind: 'mob',
      index: i,
      x: g.x,
      z: g.z,
      template_id: mobs[g.template_idx].template_id,
      size: g.size,
      spawned_at_ms,
      group_seed: String(g.group_seed),
    })
  })
  cells.forEach((c, i) => {
    if (bit_get(zone.res_bitmap, i)) return // consumed — already harvested
    const entry = resources[c.template_idx]
    rows.push({
      spawn_id: c.spawn_id.toString(),
      kind: 'resource',
      index: i,
      x: c.x,
      z: c.z,
      template_id: entry.template_id,
      remaining: 1, // one-harvest/one-bit law — depletion is the bitmap, never a charge counter
      job: Number(entry.job),
      tier: Number(entry.tier),
    })
  })
  return rows
}

export const _spacing = MIN_SPAWN_SPACING
