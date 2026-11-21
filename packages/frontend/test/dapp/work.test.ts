// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import {
  craft_required_level,
  craft_success_percent,
  craft_xp_at_level,
  gather_quantity_bounds,
  gather_time_ms,
  gather_xp,
  job_slugs,
  job_xp_for_level,
  tier_unlock_level,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import recipes from '../../../../seed/content/recipes.json'
import worlds from '../../../../seed/content/worlds.json'
import { account_bag } from '../../src/dapp/account.ts'
import type { WorkPick } from '../../src/dapp/strategies.ts'
import {
  best_worker,
  craft_facts,
  gather_facts,
  job_options,
  recipe_rows,
  resource_rows,
  work_needs,
  work_tries,
} from '../../src/dapp/work.ts'

import { HERO, account_fixture, character_fixture, hero_id, item_fixture } from './fixtures.ts'

const SECOND = hero_id('2')
/** A hero at an exact profession level: the job curve's own threshold. */
const worker = (id: string, jobs: Readonly<Record<string, number>>, row: Partial<CharacterRow> = {}) =>
  character_fixture({
    id,
    jobs: Object.fromEntries(Object.entries(jobs).map(([job, level]) => [job, String(job_xp_for_level(level) ?? 0)])),
    ...row,
  })
const novice = worker(HERO, {})
const farmer = worker(SECOND, { FARMER: 30 }, { level: 2 })
/** The seed's recipes as plain rows: the JSON import types each input set by its own keys. */
type Recipe = Readonly<{ output_type: string; inputs: Readonly<Record<string, number>> }>
const flour = (recipes as unknown as readonly Recipe[]).find(({ output_type }) => output_type === 'wheat_flour')!
const hoe = { ...item_fixture('old_hoe', 1, 'hoe'), category: 'tool_farmer' }
const bag = (items: readonly object[], more: Parameters<typeof account_fixture>[0] = {}) =>
  account_bag(account_fixture({ items, ...more }))!

test('every profession names its best hero: the highest level, then the strongest', () => {
  const options = job_options([novice, farmer])
  expect(options.map(({ job }) => job)).toEqual([...job_slugs])
  expect(options.filter(({ gathers }) => gathers).map(({ job }) => job)).toEqual(['FARMER', 'HERBALIST', 'MINER'])
  expect(options.find(({ job }) => job === 'FARMER')!.worker).toEqual({ hero: farmer, level: 30 })
  // Equal levels: the stronger hero, whatever order they come in.
  const strong = worker(hero_id('3'), {}, { level: 9 })
  expect(best_worker([novice, strong], 'MINER')).toEqual({ hero: strong, level: 1 })
  expect(best_worker([strong, novice], 'MINER')).toEqual({ hero: strong, level: 1 })
  expect(best_worker([], 'MINER')).toBeNull()
})

test('resources and recipes carry the level the game opens them at, from the seed and nothing else', () => {
  const nauvis = worlds.find(({ world }) => world === 'nauvis')!
  const rows = resource_rows('nauvis')
  expect(rows.map(({ item_type }) => item_type)).toEqual(nauvis.resources.map(({ item_type }) => item_type))
  for (const { tier, required_level } of rows) expect(required_level).toBe(tier_unlock_level(tier))
  expect(resource_rows('no_such_world')).toEqual([])
  const farming = recipe_rows('FARMER')
  expect(farming.find(({ item_type }) => item_type === 'wheat_flour')).toEqual({
    item_type: 'wheat_flour',
    inputs: flour.inputs,
    required_level: craft_required_level(Object.keys(flour.inputs).length),
  })
  expect(recipe_rows('NO_SUCH_JOB')).toEqual([])
})

test('one harvest and one try are the chain’s own rules for that hero’s level', () => {
  const wheat = gather_facts(farmer, 'wheat')!
  const [min, max] = gather_quantity_bounds(30, 1)
  expect(wheat).toMatchObject({
    job: 'FARMER',
    level: 30,
    required_level: 1,
    unlocked: true,
    quantity: { min, max },
    seconds: gather_time_ms(30) / 1_000,
    xp: gather_xp(1),
  })
  // A resource of a higher tier is locked for a new hero, and says the level that opens it.
  expect(gather_facts(novice, 'wheat_barley')).toMatchObject({ unlocked: false, required_level: tier_unlock_level(2) })
  expect(gather_facts(novice, 'wheat_flour')).toBeNull()
  const ingredients = Object.keys(flour.inputs).length
  expect(craft_facts(farmer, 'wheat_flour')).toMatchObject({
    job: 'FARMER',
    level: 30,
    required_level: craft_required_level(ingredients),
    unlocked: true,
    percent: craft_success_percent(30),
    xp: craft_xp_at_level(ingredients, 30),
  })
  expect(
    craft_facts(farmer, 'wheat_flour')!.ingredients.map(({ item_type, quantity }) => [item_type, quantity])
  ).toEqual(Object.entries(flour.inputs))
  expect(craft_facts(farmer, 'wheat')).toBeNull()
})

test('the tries an amount takes are the only arithmetic: the average yield, and the success rate', () => {
  const gather = (amount: number): WorkPick => ({
    mode: 'gather',
    item_type: 'wheat',
    goal: { kind: 'amount', amount },
  })
  const craft = (amount: number): WorkPick => ({
    mode: 'craft',
    item_type: 'wheat_flour',
    goal: { kind: 'amount', amount },
  })
  const [min, max] = gather_quantity_bounds(30, 1)
  expect(work_tries(farmer, gather(100))).toBe(Math.ceil(100 / ((min + max) / 2)))
  expect(work_tries(farmer, craft(40))).toBe(Math.ceil(40 / (craft_success_percent(30) / 100)))
  // A new hero succeeds half the time: twice the tries.
  expect(work_tries(novice, craft(10))).toBe(20)
  // No amount to reach, no figure.
  expect(work_tries(farmer, { mode: 'auto', job: null })).toBeNull()
  expect(work_tries(farmer, { mode: 'gather', item_type: 'wheat', goal: { kind: 'until_stopped' } })).toBeNull()
  expect(
    work_tries(farmer, { mode: 'craft', item_type: 'wheat_flour', goal: { kind: 'job_level', level: 40 } })
  ).toBeNull()
  expect(
    work_tries(farmer, { mode: 'craft', item_type: 'no_such_item', goal: { kind: 'amount', amount: 1 } })
  ).toBeNull()
})

test('what the work needs is read from the hero’s own kiosk: its tool, or the materials of its tries', () => {
  const until = (mode: 'gather' | 'craft', item_type: string): WorkPick => ({
    mode,
    item_type,
    goal: { kind: 'until_stopped' },
  })
  // Harvesting needs the tool of its profession: in the bag, worn, or missing.
  expect(work_needs(bag([hoe]), farmer, until('gather', 'wheat'))).toEqual({
    tool: { job: 'FARMER', item_type: 'old_hoe', worn: false },
    materials: [],
  })
  const worn = { ...hoe, slot: 'tool' } as unknown as CharacterRow['equipment'][number]
  expect(work_needs(bag([]), { ...farmer, equipment: [worn] }, until('gather', 'wheat')).tool).toEqual({
    job: 'FARMER',
    item_type: 'old_hoe',
    worn: true,
  })
  expect(work_needs(bag([]), farmer, until('gather', 'wheat')).tool).toEqual({
    job: 'FARMER',
    item_type: null,
    worn: false,
  })
  // One try of a recipe: its ingredients against the kiosk, with what is missing.
  const stock = bag([item_fixture('wheat', 3), { ...item_fixture('water', 9, 'far'), kiosk: '0xother' }])
  expect(work_needs(stock, farmer, until('craft', 'wheat_flour'))).toEqual({
    tool: null,
    materials: [
      { item_type: 'wheat', need: 2, have: 3, missing: 0 },
      { item_type: 'water', need: 1, have: 0, missing: 1 },
    ],
  })
  // An amount needs the materials of the tries it takes on average.
  const ten: WorkPick = { mode: 'craft', item_type: 'wheat_flour', goal: { kind: 'amount', amount: 10 } }
  const tries = work_tries(farmer, ten)!
  expect(work_needs(stock, farmer, ten).materials).toEqual([
    { item_type: 'wheat', need: 2 * tries, have: 3, missing: 2 * tries - 3 },
    { item_type: 'water', need: tries, have: 0, missing: tries },
  ])
  // The bot's own pick, and work the seed does not know, need nothing the page can name.
  for (const pick of [{ mode: 'auto', job: null } as const, until('gather', 'no_such_plant'), until('craft', 'wheat')])
    expect(work_needs(stock, farmer, pick)).toEqual({ tool: null, materials: [] })
})
