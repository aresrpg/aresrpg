// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWN COMPOSITION MIRROR — the level is picked at discovery time, like the presence of an archi: the PURE
// client mirror of the chain's seeded group composition. The chain resolves every
// member at DISCOVERY: zones.move rolls `MobGroupSpawn.group_seed` with the zone's own `&Random`, and
// fight.move `create` (packages/move/engine/sources/fight.move:224-231) derives each member from it by
// threading `mob::spawn_seeded` (mob.move:111-143) over the foundation prng — zero fight-side randomness, so
// the composition is PUBLIC from the moment the map advertises the group. `@aresrpg/sim`'s prng is the very
// reference prng.move was ported from (same mulberry32, byte-identical streams), which makes this mirror exact
// by construction; the FROZEN Move vector (engine pure_tests.move `spawn_seeded_pinned_vector_freezes_stream`)
// is pinned in spawn_compose.test.js so any drift on either side breaks a test before it lies to a player.
// Pure module on purpose (only the sim import — no i18n/DOM) so bun test loads it headless.

import { rng_seed, rng_int, rng_range } from '@aresrpg/sim/prng'

import { is_archi_tier } from '../content/mob_tier'

// GameConfig dial fallbacks (config.move:90/97 DEFAULT_ARCHIMOB_BP / DEFAULT_TEAM_SIZE) — the live dials ride
// /v1/config `dials{}` but only exist there once a DialChanged event ever fired; absent = the chain defaults.
export const DEFAULT_ARCHIMOB_BP = 50 // 0.50% (§17.26)
export const DEFAULT_TEAM_BOUND = 6 // §17.8

const MASK32 = 0xffff_ffffn // prng.move `rng_seed` keeps only the low 32 bits of the u64 group_seed

/**
 * Derive the group's exact members from its DISCOVERY-time seed — fight.move `create` × mob.move
 * `spawn_seeded`, in the chain's draw order per member:
 *   1. level — `rng_range(min, max)` (SKIPPED when the band is degenerate: min == max — no draw)
 *   2. archimob — `rng_int(10000) < archimob_bp` (ALWAYS drawn, even at bp 0)
 *   3. board cell — one draw whose VALUE is board-geometry-dependent and irrelevant here, but whose STATE
 *      advance must thread into the next member (mob_ai.move `seeded_spawn_cell` consumes exactly one draw).
 * Member count mirrors fight.move `clamp_group(group_size, team_bound)`: capped at the bound, floored at 1.
 * @param {string|number|bigint} group_seed the on-chain u64 (decimal string from the SDK zone row)
 * @param {{ min_level:number, max_level:number, size:number, archimob_bp?:number|null, team_bound?:number|null }} spec
 * @returns {{ members: Array<{ level:number, archi:boolean }>, state: number }} `state` = the advanced prng
 *   state after the last member (uint32) — the cross-language anchor the vector test pins.
 */
const PROGRESS_SCALE = 1000 // mob.move PROGRESS_SCALE — `progress` ∈ [0, 1000]
const BAND_WINDOW_BP = 2500 // mob.move BAND_WINDOW_BP — the drawn window is a quarter of the authored band

/**
 * The level window a mob is drawn from at difficulty `progress` — twin of `mob.move::graded_band`. A
 * BAND_WINDOW_BP-wide slice of the template's AUTHORED band that SLIDES from the band's bottom at the world
 * centre to its top at the edge: progress 0 is the single value `min_level`, progress 1000 is the top quarter.
 * @returns {{ lo: number, hi: number }}
 */
export const graded_band = (min_level, max_level, progress) => {
  if (max_level <= min_level) return { lo: min_level, hi: min_level }
  const span = max_level - min_level
  const p = Math.min(progress, PROGRESS_SCALE)
  const top = min_level + Math.floor((span * p + PROGRESS_SCALE / 2) / PROGRESS_SCALE)
  const width = Math.floor((span * BAND_WINDOW_BP) / 10_000)
  return { lo: top > min_level + width ? top - width : min_level, hi: top }
}

/**
 * How many of a rolled pack actually SEAT — `fight.move clamp_group` against the LIVE team bound, floored at one
 * and never past the roster the stream derived (the roster derives at the RAW rolled size; the bound only decides
 * how many of it sit down). The ONE home every consumer counts with: the card, the rigs, and the claim roster.
 */
const seated_count = (rolled, size, team_bound) => {
  const bound = Number(team_bound ?? DEFAULT_TEAM_BOUND) || DEFAULT_TEAM_BOUND
  return Math.min(rolled, Math.max(1, Math.min(bound, Number(size) || rolled)))
}

/**
 * The pack's SEATED roster of TEMPLATE IDS — one per unit, in the chain's committed draw order: the rig each
 * member wears and the authored band its level is drawn from. A format-3 row carries `members` (already trimmed
 * to the rolled size by the derivation); a format-1/2 row carries none, and the primary repeated is exactly what
 * those zones commit — one shape feeds every consumer, no second branch downstream.
 * @param {{ template_id:string, members?:string[]|null, size?:number|null }} row a `derive_zone` mob row
 * @param {number|null} [team_bound] GameConfig team_size_bound
 * @returns {string[]}
 */
export const seated_roster = ({ template_id, members, size }, team_bound) => {
  const rolled = Array.isArray(members) && members.length ? members : null
  const n = seated_count(rolled?.length ?? Math.max(1, Number(size) || 1), size, team_bound)
  return rolled ? rolled.slice(0, n) : Array.from({ length: n }, () => template_id)
}

/**
 * THE CARD'S CONTENT, composed — the pure half of the group card (spawn_card.js only paints it). One row per
 * SEATED unit: its species name, its exact rolled level and its archi flag, plus the group's TRUE level span for
 * the header. `graded` is the zone's own committed format, never a caller preference: a member-list zone (format
 * 3) seats every unit from its own spec at `graded_band(min, max, progress)`, a format-1/2 zone still replays the
 * flat authored band, and painting either with the other's math advertises a pack the fight will never seat.
 * A row with no `group_seed` (stale SDK read) carries `level: null` — the caller prints the honest band instead.
 * @param {{ roster: Array<{name:string, min_level:number, max_level:number,tier?:string|null}>, graded?:boolean,
 *   progress?:number, size?:number|null, group_seed?:string|number|bigint|null, archimob_bp?:number|null,
 *   team_bound?:number|null }} facts
 * @returns {{ span_lo:number, span_hi:number, rows:Array<{name:string, level:number|null, archi:boolean}> }}
 */
export function compose_group_card({
  roster,
  graded = false,
  progress = 0,
  size,
  group_seed,
  archimob_bp,
  team_bound,
}) {
  const specs = roster.slice(0, seated_count(roster.length, size, team_bound))
  const dials = { size: specs.length, archimob_bp, team_bound }
  const derived =
    group_seed == null
      ? null
      : graded
        ? derive_group_members_graded(group_seed, { members: specs, progress, ...dials })
        : derive_group_members(group_seed, { min_level: specs[0].min_level, max_level: specs[0].max_level, ...dials })
  const rows = specs.map((spec, i) => ({
    name: spec.name,
    level: derived ? derived.members[i].level : null,
    // An authored archi template wears the marker unconditionally; the discovery-time rarity roll remains
    // additive for an ordinary template that rolled as an archimob.
    archi: is_archi_tier(spec.tier) || !!derived?.members[i]?.archi,
  }))
  if (!derived)
    return {
      span_lo: Math.min(...specs.map((s) => s.min_level)),
      span_hi: Math.max(...specs.map((s) => s.max_level)),
      rows,
    }
  const levels = rows.map((r) => Number(r.level))
  return { span_lo: Math.min(...levels), span_hi: Math.max(...levels), rows }
}

/**
 * MIXED-PACK + DISTANCE-GRADED mirror (#1110/#1111) — twin of the engine's member-list create path over
 * `mob.move::spawn_seeded_graded`. Two things separate it from `derive_group_members`:
 *   · every member has its OWN spec (a pack holds several species now), taken positionally from `members`
 *   · the level is drawn from `graded_band(min, max, progress)`, and the draw ALWAYS happens — even when the
 *     window collapses to a point. A skipped draw on one member would shift every later member's rolls and the
 *     client would paint a different pack than the chain seats; same draw count per member, whatever it is.
 * Draw order per member is otherwise the chain's, unchanged: level · archimob · board cell.
 * @param {string|number|bigint} group_seed the on-chain u64 (decimal string from the SDK zone row)
 * @param {{ members: Array<{ min_level:number, max_level:number }>, progress:number, size?:number|null,
 *   archimob_bp?:number|null, team_bound?:number|null }} spec
 * @returns {{ members: Array<{ level:number, archi:boolean, index:number }>, state: number }}
 */
export function derive_group_members_graded(group_seed, { members: roster, progress, size, archimob_bp, team_bound }) {
  const bp = Number(archimob_bp ?? DEFAULT_ARCHIMOB_BP)
  const n = seated_count(roster.length, size, team_bound)
  const prog = Number(progress) || 0
  let state = rng_seed(Number(BigInt(group_seed ?? 0) & MASK32))
  const out = []
  for (let i = 0; i < n; i += 1) {
    const { lo, hi } = graded_band(Number(roster[i].min_level) || 0, Number(roster[i].max_level) || 0, prog)
    const lvl = rng_range(state, lo, Math.max(lo, hi))
    state = lvl.state
    const roll = rng_int(state, 10_000)
    state = roll.state
    ;({ state } = rng_int(state, 1)) // the cell draw — value unused; the stream ADVANCE must thread
    out.push({ level: lvl.value, archi: bp > 0 && roll.value < bp, index: i })
  }
  return { members: out, state: state >>> 0 }
}

export function derive_group_members(group_seed, { min_level, max_level, size, archimob_bp, team_bound }) {
  const bp = Number(archimob_bp ?? DEFAULT_ARCHIMOB_BP)
  const bound = Number(team_bound ?? DEFAULT_TEAM_BOUND) || DEFAULT_TEAM_BOUND
  const n = Math.max(1, Math.min(bound, Number(size) || 1))
  const lo = Number(min_level) || 0
  const hi = Math.max(lo, Number(max_level) || 0)
  let state = rng_seed(Number(BigInt(group_seed ?? 0) & MASK32))
  const members = []
  for (let i = 0; i < n; i += 1) {
    let level = lo
    if (hi > lo) ({ state, value: level } = rng_range(state, lo, hi))
    const roll = rng_int(state, 10_000)
    state = roll.state
    const archi = bp > 0 && roll.value < bp
    ;({ state } = rng_int(state, 1)) // the cell draw — value unused; the stream ADVANCE is what must thread
    members.push({ level, archi })
  }
  return { members, state: state >>> 0 }
}
