// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  acquisition_catalog,
  acquisition_target_range,
  acquisition_target_status,
  best_recipe_for_job_progression,
  item_acquisition,
  recipe_progression_issues,
  type AcquisitionContent,
} from '../src/acquisition.ts'

const content = Object.freeze({
  items: Object.freeze([
    Object.freeze({ item_type: 'fang', category: 'resource', level: 10 }),
    Object.freeze({ item_type: 'plate', category: 'resource', level: 10 }),
    Object.freeze({ item_type: 'hat', category: 'hat', level: 20 }),
  ]),
  recipes: Object.freeze([
    Object.freeze({ output_type: 'plate', inputs: Object.freeze({ fang: 2 }) }),
    Object.freeze({ output_type: 'hat', inputs: Object.freeze({ plate: 3 }) }),
  ]),
  mobs: Object.freeze([
    Object.freeze({
      mob_type: 'wolf',
      family: 'canine',
      role: 'normal',
      level_min: 10,
      level_max: 20,
      hp: 100,
      resistances: Object.freeze({ earth: 32_768, fire: 32_768, water: 32_768, air: 32_768 }),
      loot: Object.freeze([Object.freeze({ item_type: 'fang', chance_bp: 5_000, min_qty: 1, max_qty: 1 })]),
    }),
  ]),
  worlds: Object.freeze([
    Object.freeze({
      cities: Object.freeze([]),
      mobs: Object.freeze([Object.freeze({ mob_type: 'wolf' })]),
      resources: Object.freeze([]),
    }),
  ]),
  dungeons: Object.freeze([]),
}) satisfies AcquisitionContent

describe('content acquisition estimates', () => {
  test('folds five-mob drops, quantities and craft failure through the recipe graph', () => {
    const estimates = acquisition_catalog(content)
    const fang = estimates.fang?.best
    const plate = estimates.plate?.craft
    const hat = estimates.hat?.craft

    expect(fang).not.toBeNull()
    expect(fang!.minimum_seconds).toBeLessThanOrEqual(fang!.maximum_seconds)
    expect(plate!.minimum_seconds).toBeGreaterThan(fang!.minimum_seconds * 2)
    expect(hat!.minimum_seconds).toBeGreaterThan(plate!.minimum_seconds * 3)
    expect(estimates.hat?.ingredients[0]?.quantity).toBe(3)
  })

  test('selected-item evaluation matches the full validation catalog', () => {
    expect(item_acquisition(content, 'hat')).toEqual(acquisition_catalog(content).hat)
  })

  test('marks unplaced mob materials unavailable', () => {
    const estimates = acquisition_catalog({ ...content, worlds: Object.freeze([]) })

    expect(estimates.fang?.best).toBeNull()
    expect(estimates.hat?.craft).toBeNull()
  })

  test('boss roles pay a tactical round floor in addition to real HP and resistance', () => {
    const boss = {
      ...content.mobs[0]!,
      mob_type: 'boss',
      role: 'boss',
    }
    const boss_content = {
      ...content,
      mobs: Object.freeze([boss]),
      worlds: Object.freeze([
        Object.freeze({
          cities: Object.freeze([]),
          mobs: Object.freeze([{ mob_type: 'boss' }]),
          resources: Object.freeze([]),
        }),
      ]),
    }

    expect(acquisition_catalog(boss_content).fang?.best?.minimum_seconds).toBeGreaterThan(
      acquisition_catalog(content).fang!.best!.minimum_seconds
    )
  })

  test('archimob loot uses the five-target farming profile for expected replacement time', () => {
    const eye = Object.freeze({ item_type: 'archi_eye', category: 'resource', level: 20 })
    const archi = Object.freeze({
      ...content.mobs[0]!,
      mob_type: 'wolf_archi',
      role: 'archi',
      loot: Object.freeze([Object.freeze({ item_type: 'archi_eye', chance_bp: 10_000, min_qty: 1, max_qty: 1 })]),
    })
    const estimates = acquisition_catalog({
      ...content,
      items: Object.freeze([...content.items, eye]),
      mobs: Object.freeze([...content.mobs, archi]),
    })

    expect(estimates.archi_eye?.best?.minimum_seconds).toBeCloseTo(1_231.25)
  })

  test('class area coverage reduces five-mob farming time without pretending every class has it', () => {
    const area_content = {
      ...content,
      spells: Object.freeze([
        Object.freeze({
          classe: 'area_class',
          unlock_level: 1,
          levels: Object.freeze([
            Object.freeze({
              effects: Object.freeze([Object.freeze({ kind: 0, stat: 0, turns: 0, area_shape: 6, area_size: 0 })]),
            }),
          ]),
        }),
        Object.freeze({
          classe: 'point_class',
          unlock_level: 1,
          levels: Object.freeze([
            Object.freeze({
              effects: Object.freeze([Object.freeze({ kind: 0, stat: 0, turns: 0, area_shape: 0, area_size: 0 })]),
            }),
          ]),
        }),
      ]),
    }

    expect(acquisition_catalog(area_content).fang?.best?.minimum_seconds).toBeLessThan(
      acquisition_catalog(content).fang!.best!.minimum_seconds
    )
  })

  test('finds only real same-job XP deadlocks while treating other professions as available inputs', () => {
    expect(
      recipe_progression_issues(
        [
          { output_type: 'thread', inputs: { fiber: 1, dye: 1, water: 1 }, job: 'TAILOR' },
          { output_type: 'hat', inputs: { thread: 2, needle: 1 }, job: 'TAILOR' },
          { output_type: 'carved_head', inputs: { ore: 1, wood: 1, resin: 1, wool: 1 }, job: 'CARVER' },
          { output_type: 'hoe', inputs: { carved_head: 1, handle: 1 }, job: 'HANDYMAN' },
          { output_type: 'hammer', inputs: { ore: 1, handle: 1, leather: 1 }, job: 'HANDYMAN' },
          { output_type: 'machine', inputs: { ore: 1, wood: 1, resin: 1, leather: 1 }, job: 'HANDYMAN' },
        ],
        ['TAILOR', 'HANDYMAN']
      )
    ).toEqual([
      {
        job: 'TAILOR',
        level: 1,
        slot_capacity: 2,
        reachable_recipe_count: 0,
      },
    ])
  })

  test('recommends the reachable unlocked recipe with the best XP per acquisition second', () => {
    const recipes = [
      { output_type: 'slow_blade', inputs: { slow_ore: 2, handle: 1 }, job: 'FORGER' },
      { output_type: 'fast_blade', inputs: { fast_ore: 1, handle: 1 }, job: 'FORGER' },
      { output_type: 'alloy', inputs: { fast_ore: 1, coal: 1, water: 1 }, job: 'FORGER' },
      { output_type: 'blocked_blade', inputs: { alloy: 1, handle: 1 }, job: 'FORGER' },
      { output_type: 'carved_head', inputs: { wood: 1, resin: 1, hide: 1, water: 1 }, job: 'CARVER' },
      { output_type: 'cross_job_blade', inputs: { carved_head: 1, handle: 1 }, job: 'FORGER' },
    ]
    const seconds = new Map([
      ['slow_ore', 10],
      ['fast_ore', 1],
      ['handle', 1],
      ['coal', 1],
      ['water', 1],
      ['carved_head', 5],
    ])
    const input_seconds = (item_type: string): number | null => seconds.get(item_type) ?? null

    expect(best_recipe_for_job_progression(recipes, 'FORGER', 1, input_seconds)?.output_type).toBe('fast_blade')
    expect(best_recipe_for_job_progression(recipes, 'FORGER', 10, input_seconds)?.output_type).toBe('alloy')
    expect(best_recipe_for_job_progression(recipes, 'FORGER', 100, input_seconds)).toBeNull()
  })

  test('keeps provisional acquisition targets broad and level-aware', () => {
    const target = acquisition_target_range(content.items[2]!)

    expect(target).toEqual({ minimum_seconds: 1_200, maximum_seconds: 4_800 })
    expect(acquisition_target_status({ minimum_seconds: 1_500, maximum_seconds: 2_000 }, target)).toBe('within')
    expect(acquisition_target_status({ minimum_seconds: 100, maximum_seconds: 200 }, target)).toBe('below')
  })
})
