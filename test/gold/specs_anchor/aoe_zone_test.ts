// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bun test — the pure AoE-zone contract (sibling of aoe_zone.ts / aoe_zone.spec.ts, click_verify_test idiom).
// Named *_test.ts (NOT *.test.ts) on purpose: the anchor Playwright config has no testMatch override, so its
// default `**/*.@(spec|test).?(c|m)[jt]s?(x)` would collect a `.test.ts` sibling as a browser spec and explode
// on the bun:test import; the underscore form is bun-discoverable and Playwright-invisible.
//   run: bun test test/gold/specs_anchor/aoe_zone_test.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-expect-error tsconfig.lint.json (lint-only ts.Program, types:["node"]) has no bun:test declarations — the
// runtime is bun itself; this turns into an "unused directive" tripwire the day @types/bun lands at the root.
import { describe, expect, test } from 'bun:test'

// Relative on purpose: workspace links land under each DEPENDENT package's node_modules (packages/frontend/…),
// so a bare '@aresrpg/sim' cannot resolve from test/gold — the spec derives in-page via Vite's /@id/ for the
// same reason. This is the identical file that import would load.
import { get_aoe_cells } from '../../../packages/sim/src/spell_targeting.js'

import { find_aoe_stage, zone_verdicts, type Arena, type Cell, type HpRow } from './aoe_zone'

const open_arena = (width: number, height: number, blocked: readonly Cell[] = []): Arena => {
  const cells = new Array<number>(width * height).fill(0)
  for (const cell of blocked) cells[cell.y * width + cell.x] = 1
  return { width, height, cells }
}
const key = (cell: Cell) => `${cell.x}:${cell.y}`
const neighbors = (cell: Cell): Cell[] => [
  { x: cell.x + 1, y: cell.y },
  { x: cell.x - 1, y: cell.y },
  { x: cell.x, y: cell.y + 1 },
  { x: cell.x, y: cell.y - 1 },
]
const mob = (id: string, cell: Cell): { id: string; cell: Cell; dead: boolean } => ({ id, cell, dead: false })

describe('find_aoe_stage — the cross-zone stage search (setup law of the AoE proof)', () => {
  test('finds the NEAREST reachable cell adjacent to a living mob whose 4 neighbors are all on-board terrain', () => {
    const arena = open_arena(5, 5)
    const state = { me: mob('me', { x: 0, y: 0 }), mobs: [mob('mob-0', { x: 3, y: 2 })], arena }
    const found = find_aoe_stage(state)
    expect(found).not.toBeNull()
    // stage law: every orthogonal neighbor on-board walkable terrain, and the fixture mob on one of them
    expect(neighbors(found!.stage).every((c) => c.x >= 0 && c.y >= 0 && c.x < 5 && c.y < 5)).toBe(true)
    expect(neighbors(found!.stage).some((c) => key(c) === '3:2')).toBe(true)
    // nearest: the mob sits 5 steps away, its closest legal stage 4 — the path walks exactly there
    expect(found!.path.length).toBe(4)
    expect(key(found!.path[found!.path.length - 1])).toBe(key(found!.stage))
  })

  test('returns the current cell with an EMPTY path when already standing on a stage', () => {
    const arena = open_arena(5, 5)
    const state = { me: mob('me', { x: 2, y: 2 }), mobs: [mob('mob-0', { x: 2, y: 3 })], arena }
    expect(find_aoe_stage(state)).toEqual({ stage: { x: 2, y: 2 }, path: [] })
  })

  test('rejects edge stages (a clipped cross) — a 1-row board has no stage at all', () => {
    const arena = open_arena(5, 1)
    const state = { me: mob('me', { x: 0, y: 0 }), mobs: [mob('mob-0', { x: 3, y: 0 })], arena }
    expect(find_aoe_stage(state)).toBeNull()
  })

  test('rejects obstacle-terrain stages — a mob only cornered by walls/edges yields null', () => {
    const arena = open_arena(3, 3, [{ x: 1, y: 1 }])
    const state = { me: mob('me', { x: 0, y: 0 }), mobs: [mob('mob-0', { x: 2, y: 1 })], arena }
    expect(find_aoe_stage(state)).toBeNull()
  })

  test('never stops on (or walks through) a cell occupied by a living fighter', () => {
    const arena = open_arena(5, 5)
    const blocker = mob('mob-1', { x: 2, y: 2 }) // squats the naive nearest stage
    const state = { me: mob('me', { x: 0, y: 0 }), mobs: [mob('mob-0', { x: 3, y: 2 }), blocker], arena }
    const found = find_aoe_stage(state)
    expect(found).not.toBeNull()
    expect(key(found!.stage)).not.toBe(key(blocker.cell))
    expect(found!.path.every((step) => key(step) !== key(blocker.cell) && key(step) !== '3:2')).toBe(true)
    expect(neighbors(found!.stage).some((c) => key(c) === '3:2' || key(c) === '2:2')).toBe(true)
  })
})

// The senshi cross-1 zone at (2,2): center + the 4 arms.
const cross = (center: Cell): Cell[] => [center, ...neighbors(center)]
const row = (id: string, cell: Cell, health: number, dead = false): HpRow => ({ id, cell, dead, health })

describe('zone_verdicts — the per-entity zone-effect law (one function, display AND chain oracles)', () => {
  const zone = cross({ x: 2, y: 2 })
  const me = { id: 'me', cell: { x: 2, y: 2 } }

  test('passes when every in-zone mob lost hp, the out-of-zone mob is untouched, and the caster is unharmed', () => {
    const before = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 100), row('mob-1', { x: 4, y: 4 }, 100)]
    const after = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 86), row('mob-1', { x: 4, y: 4 }, 100)]
    const verdicts = zone_verdicts({ zone, caster_id: 'me', before, after })
    expect(verdicts.ok).toBe(true)
    expect(verdicts.hits).toBe(1)
    expect(verdicts.rows.find((r) => r.id === 'mob-1')?.expect).toBe('untouched')
  })

  test('counts EVERY living in-zone mob as a required hit — two adjacent mobs, both must drop', () => {
    const before = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 100), row('mob-1', { x: 2, y: 1 }, 100)]
    const after = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 89), row('mob-1', { x: 2, y: 1 }, 91)]
    const verdicts = zone_verdicts({ zone, caster_id: 'me', before, after })
    expect(verdicts.ok).toBe(true)
    expect(verdicts.hits).toBe(2)
  })

  test('FAILS when an in-zone mob is untouched (the AoE-miss class the spec exists to catch)', () => {
    const before = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 100), row('mob-1', { x: 2, y: 1 }, 100)]
    const after = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 86), row('mob-1', { x: 2, y: 1 }, 100)]
    const verdicts = zone_verdicts({ zone, caster_id: 'me', before, after })
    expect(verdicts.ok).toBe(false)
    expect(verdicts.rows.find((r) => r.id === 'mob-1')?.ok).toBe(false)
  })

  test('FAILS when an OUT-of-zone mob lost hp (zone leak)', () => {
    const before = [row('me', me.cell, 300), row('mob-0', { x: 4, y: 4 }, 100)]
    const after = [row('me', me.cell, 300), row('mob-0', { x: 4, y: 4 }, 93)]
    expect(zone_verdicts({ zone, caster_id: 'me', before, after }).ok).toBe(false)
  })

  test('FAILS when the caster took damage (the enemies-only target filter must hold inside its own zone)', () => {
    const before = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 100)]
    const after = [row('me', me.cell, 289), row('mob-0', { x: 3, y: 2 }, 86)]
    expect(zone_verdicts({ zone, caster_id: 'me', before, after }).ok).toBe(false)
  })

  test('a mob already dead at cast time is exempt — untouched in the zone is lawful', () => {
    const before = [row('me', me.cell, 300), row('dead', { x: 2, y: 1 }, 0, true), row('mob-0', { x: 3, y: 2 }, 100)]
    const after = [row('me', me.cell, 300), row('dead', { x: 2, y: 1 }, 0, true), row('mob-0', { x: 3, y: 2 }, 86)]
    const verdicts = zone_verdicts({ zone, caster_id: 'me', before, after })
    expect(verdicts.ok).toBe(true)
    expect(verdicts.hits).toBe(1)
  })

  test('a missing after-row is a broken oracle read — loud red, never a silent pass', () => {
    const before = [row('me', me.cell, 300), row('mob-0', { x: 3, y: 2 }, 100)]
    const after = [row('me', me.cell, 300)]
    const verdicts = zone_verdicts({ zone, caster_id: 'me', before, after })
    expect(verdicts.ok).toBe(false)
    expect(verdicts.rows.find((r) => r.id === 'mob-0')?.after).toBeNull()
  })

  test('empty evidence is never a pass', () => {
    expect(zone_verdicts({ zone, caster_id: 'me', before: [], after: [] }).ok).toBe(false)
  })
})

describe('corpus/sim contract pin — the facts aoe_zone.spec.ts stands on', () => {
  const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const corpus_path = path.resolve(gold, '..', '..', 'seed', 'mainnet', 'spells', 'senshi.json')
  const corpus = JSON.parse(fs.readFileSync(corpus_path, 'utf8')) as Array<Record<string, unknown>>
  const oathblade = corpus.find((spell) => spell.id === 'senshi_oathblade') as {
    unlock: number
    levels: Array<{
      range_min: number
      range_max: number
      ap_cost: number
      effects: Array<{ kind: number; area_shape: number; area_size: number; target_filter: number }>
    }>
  }

  test('senshi_oathblade stays the level-1 self-centered CROSS damage spell the spec casts', () => {
    expect(oathblade).toBeTruthy()
    expect(oathblade.unlock).toBe(1)
    const [level] = oathblade.levels
    expect([level.range_min, level.range_max]).toEqual([0, 0]) // self-cast — the zone centers on the caster
    const [damage] = level.effects
    expect(damage.kind).toBe(0) // K_DAMAGE
    expect(damage.area_shape).toBe(2) // SHAPE_CROSS — a real multi-cell zone
    expect(damage.area_size).toBe(1)
    expect(damage.target_filter).toBe(1) // TF_NOT_TEAM — enemies only, the caster stands in its own zone unharmed
  })

  test("the sim's zone-set derivation resolves that effect to the exact 5-cell cross (the chain's byte-twin)", () => {
    const [damage] = oathblade.levels[0].effects
    const center = { x: 5, y: 5 }
    const cells = get_aoe_cells(damage, center, center).map(key)
    expect([...cells].sort()).toEqual(['4:5', '5:4', '5:5', '5:6', '6:5'])
  })

  test('the derivation clips at the grid edge (corner cross = 3 cells) — why the stage law demands 4 clean neighbors', () => {
    const [damage] = oathblade.levels[0].effects
    const corner = { x: 0, y: 0 }
    const cells = get_aoe_cells(damage, corner, corner).map(key)
    expect([...cells].sort()).toEqual(['0:0', '0:1', '1:0'])
  })
})
