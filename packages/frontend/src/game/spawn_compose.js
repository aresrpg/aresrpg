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
