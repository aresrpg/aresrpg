// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DRAW-PROPORTIONALITY INSTRUMENT (issue #1491) — what fraction of the mobs a roaming player meets is
// archi-tier, measured over the REAL kernel on the REAL live spawn tables, never inferred from the weights.
//
// The row that put this file here: archi-tier mobs are ruled to spawn at 1% (maintainer resolution on #1491 —
// zone rates stay EQUAL, the #1111 equal-spawn gate stands, and archi rarity becomes a game-side rare draw), and
// live play meets them constantly. A rate fix that draws wrong would be invisible until measured, so the
// measurement lands first and outlives whichever side the fix eventually rides.
//
// Every number here is COUNTED over >=10k seeded draws against
// `fixtures/world_spawn_tables_live.json` — all 20 seeded worlds, all 329 mob-table rows, every row joined to its
// authored tier by NAME (the fixture's provenance block carries the capture method). No sampling shortcuts: a
// share quoted from a 100-draw vibe check is a hypothesis, not a measurement.
import { describe, test, expect } from 'bun:test'

import {
  derive_zone,
  size_cap,
  spawn_distance_progress,
} from '../src/zone_derive.js'

import live from './fixtures/world_spawn_tables_live.json'

/**
 * THE RULED ARCHI SPAWN RATE, in basis points — maintainer resolution on #1491: "archis become a game-side RARE
 * DRAW at 1% (the archi replaces its base mob at spawn-draw time; zone tables stay equal, the equal-spawn gate
 * stands)". This is the ONE home of that number in this repository: the chain carries no archi predicate at all
 * (`MobTemplate` has no role field — see `packages/frontend/src/game/data/mobs.js`), so the rate the draw
 * actually realises is emergent from the authored `rate_bp` rows and is measured below, never declared twice.
 * Not to be confused with `GameConfig.archimob_bp` (config.move DEFAULT_ARCHIMOB_BP = 50) — that dial is the
 * per-member roll that TAGS an ordinary mob as an archimob, a different mechanism from which template spawns.
 */
const ARCHI_RATE_BP = 100
const RATE_TOLERANCE_BP = 50 // the ruling's stated tolerance: 1% +/- 0.5 absolute

const MIN_DRAWS = 10_000 // the count-don't-extrapolate floor every assertion in this file clears
const TEAM_BOUND = 6 // config.move DEFAULT_TEAM_SIZE — the live engine bound the caps lerp toward

/** mulberry32 over a fixed root — the zone seeds are sampled DETERMINISTICALLY so every number here replays. */
const sampler = root => {
  let s = root >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A 33-byte commitment root of `format` — what `commitment_format` reads off a stored zone commitment. */
const root_of = format => [format, ...Array.from({ length: 32 }, () => 0)]

const world_doc = w => ({
  zone_size: w.zone_size,
  bounds_x: w.bounds_x,
  bounds_z: w.bounds_z,
  min_groups: w.min_groups,
  max_groups: w.max_groups,
  min_nodes: 0,
  max_nodes: 0,
  spawn_zone_x: w.spawn_zone_x,
  spawn_zone_z: w.spawn_zone_z,
  boss_mask: w.boss_mask,
  mobs: w.mobs.map(m => ({
    template_id: m.template_id,
    rate_bp: m.rate_bp,
    min_group: m.min_group,
    max_group: m.max_group,
    level: m.level,
  })),
  resources: [],
})

/** The zone the FIRST-JOIN box sits in — `spawn_zone_x/z` are the box SIZE and the box is centred on bounds/2. */
const centre_zone = w => Math.floor(Math.floor(w.bounds_x / 2) / w.zone_size)

/**
 * Roam `zones_per_world` zones of every live world and count what the draw actually produced. `at` picks the
 * zone key per draw (the two regimes a player is ever in: inside the first-join box, or out on the open map).
 */
const roam = ({ format, zones_per_world, at }) => {
  const tally = {
    groups: 0,
    units: 0,
    archi_units: 0,
    mixed_groups: 0,
    multi_groups: 0,
    sizes: new Map(),
    /** @type {Map<string, {drawn:number, roster:number, picks:Map<string,number>}>} */
    per_world: new Map(),
  }
  for (const w of live.worlds) {
    const role = new Map(w.mobs.map(m => [m.template_id, m.role]))
    const doc = world_doc(w)
    const rnd = sampler(0x5eed_0000 ^ (w.wid.length * 2654435761))
    const picks = new Map()
    for (let i = 0; i < zones_per_world; i += 1) {
      const [zx, zy] = at(rnd, w)
      const rows = derive_zone({
        zone: {
          seed: Math.floor(rnd() * 0xffff_ffff),
          discovered_at_ms: 0,
          mob_bitmap: [],
          res_bitmap: [],
          group_root: root_of(format),
        },
        zx,
        zy,
        world: doc,
        team_bound: TEAM_BOUND,
      })
      for (const row of rows) {
        if (row.kind !== 'mob') continue
        const members =
          row.members ?? Array.from({ length: row.size }, () => row.template_id)
        tally.groups += 1
        tally.units += members.length
        tally.archi_units += members.filter(
          id => role.get(id) === 'archi',
        ).length
        if (members.length > 1) tally.multi_groups += 1
        if (new Set(members).size > 1) tally.mixed_groups += 1
        tally.sizes.set(row.size, (tally.sizes.get(row.size) ?? 0) + 1)
        picks.set(row.template_id, (picks.get(row.template_id) ?? 0) + 1)
      }
    }
    tally.per_world.set(w.wid, {
      drawn: picks.size,
      roster: w.mobs.length,
      picks,
    })
  }
  return tally
}

/** One shared open-map roam — every assertion below reads the SAME counted population (and it is counted once). */
const once = fn => {
  let v = null
  return () => (v ??= fn())
}

/** Uniform over the whole zone grid — the open map, where the §4 caps have fully opened. */
const anywhere = (rnd, w) => [
  Math.floor(rnd() * Math.max(1, Math.floor(w.bounds_x / w.zone_size))),
  Math.floor(rnd() * Math.max(1, Math.floor(w.bounds_z / w.zone_size))),
]
/** The first-join box itself — progress 0, where every §4 cap sits at its floor. */
const first_join = (_rnd, w) => [centre_zone(w), centre_zone(w)]

const open_map = once(() =>
  roam({ format: 3, zones_per_world: 120, at: anywhere }),
)

describe('spawn draw rates — the live tables, measured (#1491)', () => {
  // ── the instrument itself: does a row of weight w actually draw at w / Σw? ──────────────────────────────────
  test('the primary pick is PROPORTIONAL to the authored rate_bp (the guard on any future rate fix)', () => {
    const t = open_map()
    expect(t.groups).toBeGreaterThanOrEqual(MIN_DRAWS)
    for (const w of live.worlds) {
      const { picks } = t.per_world.get(w.wid)
      const drawn = [...picks.values()].reduce((a, n) => a + n, 0)
      const total_weight = w.mobs.reduce((a, m) => a + m.rate_bp, 0)
      for (const m of w.mobs) {
        const expected = (m.rate_bp / total_weight) * drawn
        // Poisson 5σ — the honest band for a count, not a flat percentage: wide enough that 329 independent rows
        // never flake, tight enough that a draw ignoring the weights (or reading a stale table) fails on sight.
        expect(
          Math.abs((picks.get(m.template_id) ?? 0) - expected),
        ).toBeLessThan(5 * Math.sqrt(expected))
      }
    }
  })

  // ── #1491: the archi rate the draw actually realises ───────────────────────────────────────────────────────
  // RED WITNESS. Measured 2026-07-29 over 44 981 groups / 112 902 units on the live tables: 1786 bp (17.86%) —
  // 17.9× the ruled 100 bp. Cause: all 60 authored archi rows sit in the world spawn tables at the SAME
  // `rate_bp` as every normal row (the #1111 equal-spawn ruling applied to them too), so 60 of the 329 live rows
  // — 18.24% of the pick table — are archi. Nothing in the draw knows what an archi is: the chain carries no
  // archi predicate (`MobTemplate` has no role field), so the fix is a chain-side rare-draw kernel change plus a
  // world-side archi mask, exactly like the `boss_mask` fence, and rides a publish. `test.failing` seals the
  // check RED: the day the draw honours the ruling this test FAILS and must be flipped to a plain `test`.
  test.failing(
    'archi-tier mobs draw at the ruled 1% — RED until the rare-draw lands (#1491)',
    () => {
      const t = open_map()
      expect(t.units).toBeGreaterThanOrEqual(MIN_DRAWS)
      const measured_bp = (t.archi_units / t.units) * 10_000
      expect(Math.abs(measured_bp - ARCHI_RATE_BP)).toBeLessThanOrEqual(
        RATE_TOLERANCE_BP,
      )
    },
  )

  test('the archi over-rate is the TABLE share, not a correlated roll (what the fix has to move)', () => {
    const t = open_map()
    const table_share =
      live.worlds.flatMap(w => w.mobs).filter(m => m.role === 'archi').length /
      live.worlds.flatMap(w => w.mobs).length
    // The realised archi share tracks the pick table's own archi share — the draw is faithful, the TABLE is not
    // rare. A rare-draw fix must break this equality; while it holds, no amount of roll-decorrelation helps.
    expect(Math.abs(t.archi_units / t.units - table_share)).toBeLessThan(0.02)
  })

  // ── #1098 part 3: do groups mix species? ───────────────────────────────────────────────────────────────────
  test('format 3 packs MIX species; format 2 packs never do', () => {
    const mixed = open_map()
    const mono = roam({ format: 2, zones_per_world: 40, at: anywhere })
    expect(mixed.multi_groups).toBeGreaterThanOrEqual(MIN_DRAWS)
    expect(mixed.mixed_groups / mixed.multi_groups).toBeGreaterThan(0.9)
    expect(mono.mixed_groups).toBe(0)
  })

  // ── #1098 part 2: zone diversity ───────────────────────────────────────────────────────────────────────────
  test('every authored row of a world is reachable in it (the #1111 equal-spawn ruling, measured)', () => {
    const t = open_map()
    for (const w of live.worlds) {
      const { drawn, roster } = t.per_world.get(w.wid)
      expect(drawn).toBe(roster)
    }
  })

  // ── group size: the §4 gradient against the authored bands ─────────────────────────────────────────────────
  test('inside the first-join box EVERY group is exactly 2 — size_cap at its floor', () => {
    const t = roam({ format: 3, zones_per_world: 60, at: first_join })
    expect(t.groups).toBeGreaterThanOrEqual(MIN_DRAWS)
    const [w] = live.worlds
    expect(
      spawn_distance_progress({
        ox: centre_zone(w) * w.zone_size,
        oz: centre_zone(w) * w.zone_size,
        zsize: w.zone_size,
        bx: w.bounds_x,
        bz: w.bounds_z,
        spawn_x: w.spawn_zone_x,
        spawn_z: w.spawn_zone_z,
      }),
    ).toBe(0)
    expect(size_cap(0, TEAM_BOUND)).toBe(2)
    expect([...t.sizes.keys()].sort((a, b) => a - b)).toEqual([2])
  })

  // RED WITNESS. Measured 2026-07-29 over 44 981 open-map groups: sizes are {2: 49.0%, 3: 51.0%} and NOTHING
  // else, at zones whose `size_cap` is the full team bound of 6. Cause: all 329 live rows author
  // `min_group = 2, max_group = 3` — one degenerate band for the entire game — so the §4 size gradient
  // (2 near the spawn, lerped to `team_bound` at the edge) is inert above 3 and a pack can never be a pack.
  // The authored bands are content (`world::me_min_group/me_max_group`, published state), so this one is fixed
  // corpus-side; the code half below already proves the kernel honours whatever band it is handed.
  test.failing(
    'the §4 size gradient reaches the team bound out on the open map — RED (#1098)',
    () => {
      const t = open_map()
      expect(t.groups).toBeGreaterThanOrEqual(MIN_DRAWS)
      expect(Math.max(...t.sizes.keys())).toBe(TEAM_BOUND)
    },
  )

  test('a rolled size never leaves [authored min, min(authored max, size_cap)]', () => {
    const t = open_map()
    expect(t.groups).toBeGreaterThanOrEqual(MIN_DRAWS)
    const bands = live.worlds.flatMap(w => w.mobs)
    const lo = Math.min(...bands.map(m => m.min_group))
    const hi = Math.min(
      Math.max(...bands.map(m => m.max_group)),
      size_cap(1000, TEAM_BOUND),
    )
    for (const size of t.sizes.keys()) {
      expect(size).toBeGreaterThanOrEqual(lo)
      expect(size).toBeLessThanOrEqual(hi)
    }
  })
})
