// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Immutable rules mirrored from Move, and the vocabularies chain writes are composed from.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  application_suins_name,
  archimob_rows,
  canonical_suins_name,
  center_distance,
  chain_to_client_coordinate,
  characteristic_allocation_quote,
  characteristic_cost_step,
  characteristic_ladders,
  characteristic_names,
  characteristic_spending_quote,
  characteristic_value_cost,
  characteristic_values_cost,
  chat_suins_prefix,
  class_names,
  class_spell_shape_errors,
  class_spell_unlocks,
  client_to_chain_coordinate,
  cosmetic_slots,
  craft_batch_limit,
  craft_job_of,
  craft_max_ingredients,
  craft_required_level,
  craft_success_percent,
  craft_xp_at_level,
  craft_xp_from_ingredient_count,
  display_suins_name,
  equipment_categories,
  equipment_slot_accepts,
  experience_progress,
  format_rune_weight,
  gather_gate,
  gather_quantity_bounds,
  gather_time_ms,
  gather_xp,
  gatherable_catalog,
  gatherable_of,
  is_class_name,
  is_cosmetic_category,
  is_item_category,
  is_job_slug,
  is_weapon_category,
  item_categories,
  item_is_stackable,
  job_experience_progress,
  job_kind_of,
  job_level_from_xp,
  job_slugs,
  job_xp_for_level,
  level_from_xp,
  mob_band_scaled,
  mob_centered_band_scaled,
  mob_effect_value_scaled,
  mob_group_size_bounds,
  mob_loot_chance_scaled,
  mob_pool_scaled,
  model_variant_identity,
  pet_max_feeds,
  rare_pet_food_tier,
  rig_slots,
  roll_quality,
  rune_can_apply,
  rune_effect,
  stat_names,
  tier_unlock_level,
  worn_appearance,
  xp_for_level,
} from '../src/index.ts'
import { blast_csv, cap_mist, normalize_address, public_award, share_version, sui_amount } from '../src/allocation.ts'
import { allocation_locale, notification_locale } from '../src/locale.ts'
import { rune_max_weight, rune_unit_weight, rune_weight_scale } from '../src/rune.ts'

const move_source = (path: string): string => readFileSync(resolve(import.meta.dir, '../../', path), 'utf8')

describe('Move-mirrored math', () => {
  test('experience and job curves floor between thresholds and clamp at their caps', () => {
    expect([1, 2, 20, 50, 100, 190, 200].map(xp_for_level)).toEqual([
      0, 110, 171_000, 5_350_000, 95_886_000, 2_054_975_000, 7_407_232_000,
    ])
    expect([0, 109, 110, 95_885_999, 95_886_000, Number.MAX_SAFE_INTEGER].map(level_from_xp)).toEqual([
      1, 1, 2, 99, 100, 200,
    ])
    expect(experience_progress(380)).toEqual({ level: 2, into: 270, span: 540, percent: 50 })
    expect(experience_progress(7_407_232_000)).toEqual({ level: 200, into: 0, span: 0, percent: 100 })
    expect([50, 581_687].map(job_level_from_xp)).toEqual([2, 100])
    expect(job_xp_for_level(100)).toBe(581_687)
    expect(job_experience_progress(581_687)).toMatchObject({ level: 100, percent: 100 })
    expect([1, 2, 11, 12].map(tier_unlock_level)).toEqual([1, 10, 100, 100])
  })

  test('crafting and gathering formulas match their job_xp.move twins', () => {
    expect(craft_max_ingredients).toBe(8)
    expect([2, 3, 4, 5, 6, 7, 8].map(craft_required_level)).toEqual([1, 10, 20, 40, 60, 80, 100])
    expect([2, 3, 4, 5, 6, 7, 8].map(craft_xp_from_ingredient_count)).toEqual([10, 25, 50, 100, 250, 500, 1000])
    // Recipes four or more slots below the crafter's capacity grant no XP.
    expect(
      [
        [2, 59],
        [2, 60],
        [3, 79],
        [3, 80],
        [4, 99],
        [4, 100],
        [5, 100],
      ].map(([count, level]) => craft_xp_at_level(count!, level!))
    ).toEqual([10, 0, 25, 0, 50, 0, 100])
    expect([1, 2, 99, 100].map(craft_success_percent)).toEqual([50, 50, 99, 99])
    expect([1, 100, 200].map(gather_time_ms)).toEqual([12_000, 2_000, 2_000])
    expect(gather_xp(31)).toBe(25)
    expect(gather_quantity_bounds(100, 1)).toEqual([6, 21])
    expect(gather_quantity_bounds(1, 1)).toEqual([1, 2])
  })

  test('mob band scaling answers the values move-math pins', () => {
    expect(mob_band_scaled(1_000n, 10n, 20n, 15n)).toBe(1_100n)
    expect(mob_band_scaled(1_000n, 10n, 10n, 10n)).toBe(1_000n)
    expect(mob_effect_value_scaled(1n, 10n, 20n, 10n)).toBe(1n)
    expect(mob_centered_band_scaled(32_868n, 32_768n, 10n, 20n, 15n)).toBe(32_878n)
    expect(mob_centered_band_scaled(32_668n, 32_768n, 10n, 20n, 15n)).toBe(32_658n)
    expect(mob_centered_band_scaled(32_668n, 32_768n, 10n, 10n, 10n)).toBe(32_668n)
    expect(mob_centered_band_scaled(0n, 32_768n, 10n, 20n, 10n)).toBe(0n)
    const loot = [
      [2n, 10n, 20n, 10n, 1n],
      [2n, 10n, 20n, 15n, 2n],
      [2n, 10n, 20n, 20n, 2n],
      [1n, 10n, 20n, 10n, 0n],
      [5_000n, 10n, 20n, 15n, 5_000n],
      [9_000n, 10n, 20n, 20n, 10_000n],
      [2n, 10n, 10n, 10n, 2n],
    ] as const
    for (const [base, low, high, level, expected] of loot)
      expect(mob_loot_chance_scaled(base, low, high, level)).toBe(expected)
    const pools = [
      [6n, 10n, 20n, 10n, 6n],
      [6n, 10n, 20n, 15n, 7n],
      [6n, 10n, 20n, 20n, 8n],
      [3n, 10n, 20n, 20n, 4n],
      [6n, 10n, 10n, 10n, 6n],
    ] as const
    for (const [base, low, high, level, expected] of pools)
      expect(mob_pool_scaled(base, low, high, level)).toBe(expected)
    // A group grows from one mob at the centre to six at 10,000 blocks; at 2,000 it spans 2..4.
    expect([0n, 2_000n, 10_000n, 50_000n].map(mob_group_size_bounds)).toEqual([
      [1n, 1n],
      [2n, 4n],
      [6n, 6n],
      [6n, 6n],
    ])
    expect(center_distance(50_003, 49_993)).toBe(7)
  })

  test('the rune catalog, weights and forge limits match Move', () => {
    const catalog = move_source('move-math/sources/rune_catalog.move')
    expect(Number(/const WEIGHT_SCALE: u64 = (\d+)/u.exec(catalog)?.[1])).toBe(rune_weight_scale)
    const weights = /const UNIT_WEIGHTS: vector<u64> = vector\[([^\]]+)\]/u.exec(catalog)![1]!.split(',')
    expect(weights.map((value) => Number(value.trim().replaceAll('_', '')))).toEqual(
      stat_names.map((stat) => rune_unit_weight(stat) * rune_weight_scale)
    )
    expect(stat_names.map(rune_unit_weight)).toEqual([0.25, 3, 1, 1, 1, 1, 51, 90, 100, 30, 20, 4, 4, 4, 4])
    for (const [tier, name] of [
      ['ba', 'BA_AMOUNT'],
      ['pa', 'PA_AMOUNT'],
      ['ra', 'RA_AMOUNT'],
    ] as const) {
      const amounts = new RegExp(`const ${name}: vector<u64> = vector\\[([^\\]]+)\\]`).exec(catalog)![1]!.split(',')
      expect(stat_names.map((stat) => rune_effect(`rune_${stat}_${tier}`)?.amount ?? 0)).toEqual(amounts.map(Number))
    }
    expect(rune_effect('rune_strength_ra')).toEqual({ stat: 'strength', tier: 'ra', amount: 10 })
    expect([rune_effect('rune_range_pa'), rune_effect('rune_unknown_ba'), rune_effect('strength')]).toEqual([
      null,
      null,
      null,
    ])

    const forge = move_source('move-math/sources/forge.move')
    expect(Number(/const MAX_OVER_WEIGHT: u64 = (\d+)/.exec(forge)?.[1])).toBe(rune_max_weight)
    const ap = rune_effect('rune_action_ba')!
    expect(rune_can_apply({ action: 1 }, { action: 1 }, ap)).toBeFalse()
    expect(rune_can_apply({ action: 0 }, { action: 1 }, ap)).toBeTrue()
    expect(rune_can_apply({}, {}, ap)).toBeTrue()
    expect(rune_can_apply({ movement: 1 }, {}, ap)).toBeFalse()
    const vitality = rune_effect('rune_vitality_ba')!
    expect(rune_can_apply({ vitality: 401 }, { vitality: 100 }, vitality)).toBeTrue()
    expect(rune_can_apply({ vitality: 402 }, { vitality: 100 }, vitality)).toBeFalse()
    expect(['1980', '7', '18446744073709551600'].map(format_rune_weight)).toEqual(['99', '0.35', '922337203685477580'])
  })

  test('characteristic ladders keep the client thresholds and match the Move twin at every edge', () => {
    expect(characteristic_ladders.shugo.strength).toEqual([
      { from: 0, cost: 2, gain: 1 },
      { from: 50, cost: 3, gain: 1 },
      { from: 150, cost: 4, gain: 1 },
      { from: 250, cost: 5, gain: 1 },
    ])
    expect(characteristic_ladders.rojin.intelligence.at(-1)).toEqual({ from: 150, cost: 5, gain: 1 })
    expect(characteristic_ladders.mori.strength[2]).toEqual({ from: 250, cost: 3, gain: 1 })
    const values = [
      0, 19, 20, 39, 40, 49, 50, 59, 60, 79, 80, 99, 100, 149, 150, 199, 200, 229, 230, 249, 250, 299, 300, 329, 330,
      349, 350, 399, 400, 500,
    ]
    const fingerprint = class_names.reduce(
      (total, classe, class_index) =>
        characteristic_names.reduce(
          (sum, stat, stat_index) =>
            values.reduce((inner, value) => {
              const { cost, gain } = characteristic_cost_step(classe, stat, value)
              return inner + BigInt((class_index + 1) * (stat_index + 1) * (value + 1) * (cost * 10 + gain))
            }, sum),
          total
        ),
      0n
    )
    expect(fingerprint).toBe(366_013_424n)

    // Quotes stage clicks across a boundary from the natural value and refuse an unusable remainder.
    const zero = { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 }
    const current = { ...zero, intelligence: 19 }
    expect(characteristic_allocation_quote('senshi', current, { intelligence: 2 })).toEqual({
      cost: 3,
      costs: { ...zero, intelligence: 3 },
      gains: { ...zero, intelligence: 2 },
    })
    expect(characteristic_spending_quote('senshi', current, { intelligence: 3 })?.gains.intelligence).toBe(2)
    expect(characteristic_spending_quote('senshi', current, { intelligence: 2 })).toBeNull()
    // Ikari vitality buys two per point; Shusen stops at three-for-one; Wisdom stays three-for-one.
    expect(characteristic_allocation_quote('ikari', zero, { vitality: 3 })).toMatchObject({
      cost: 3,
      gains: { vitality: 6 },
    })
    expect([6, 5].map((value) => characteristic_value_cost('ikari', 'vitality', value))).toEqual([3, null])
    expect(characteristic_value_cost('shusen', 'strength', 201)).toBe(353)
    expect(characteristic_value_cost('shusen', 'wisdom', 100)).toBe(300)
    expect(characteristic_values_cost('ikari', { ...zero, vitality: 6, wisdom: 100 })).toBe(303)
    expect(characteristic_values_cost('ikari', { ...zero, vitality: 5 })).toBeNull()
  })
})

describe('chain vocabularies', () => {
  test('classes, stats, jobs and the class spell law keep their Move order and shape', () => {
    expect(class_names).toHaveLength(12)
    expect([class_names[0], class_names.at(-1)]).toEqual(['shugo', 'shusen'])
    expect([is_class_name('mori'), is_class_name('wizard')]).toEqual([true, false])
    expect(stat_names).toHaveLength(15)
    expect(stat_names.slice(0, 6)).toEqual([...characteristic_names])
    expect(new Set(job_slugs).size).toBe(11)
    expect(job_slugs.slice(0, 3)).toEqual(['FARMER', 'HERBALIST', 'MINER'])
    expect([is_job_slug('MINER'), is_job_slug('miner')]).toEqual([true, false])
    expect(['MINER', 'CARVER', 'TAILOR', 'BAKER'].map((job) => job_kind_of(job as 'MINER'))).toEqual([
      'gathering',
      'weapon_craft',
      'equipment_craft',
      'consumable_craft',
    ])
    expect(pet_max_feeds).toBe(60)

    const ladder = (classe: string) =>
      class_spell_unlocks.map((unlock_level, index) => ({ name: `${classe}_${index}`, classe, unlock_level }))
    const corpus = class_names.flatMap(ladder)
    expect(class_spell_shape_errors(corpus)).toEqual([])
    expect(class_spell_shape_errors([...corpus, { name: 'extra', classe: 'senshi', unlock_level: 50 }])).toEqual([
      'senshi has 21 spells; the law is exactly 20',
    ])
    const moved = corpus.map((spell) => (spell.name === 'mori_3' ? { ...spell, unlock_level: 90 } : spell))
    expect(class_spell_shape_errors(moved)).toEqual([
      'mori breaks the unlock ladder — too many at level 90; none at level 3',
    ])
  })

  test('item categories, craft jobs, stacking and batch caps match every Move branch', () => {
    expect(new Set(item_categories).size).toBe(item_categories.length)
    expect(item_categories.slice(0, equipment_categories.length)).toEqual([...equipment_categories])
    expect(item_categories.filter(is_weapon_category)).toEqual(['daggers', 'spear', 'bow', 'axe', 'sword'])
    expect([is_item_category('pet_food'), item_is_stackable('pet_food')]).toEqual([false, false])
    expect(['rune', 'key', 'hat'].map(item_is_stackable)).toEqual([true, true, false])

    const rules = move_source('move-math/sources/content_rules.move')
    const [body] = /public fun craft_job_of[\s\S]*?\n}/.exec(rules)!
    const move_jobs = new Map<string, string>()
    for (const branch of body.matchAll(/(?:if|else if) \((.*?)\) option::some\(b"([A-Z_]+)"/gs))
      for (const category of branch[1]!.matchAll(/b"([a-z_]+)"/g)) move_jobs.set(category[1]!, branch[2]!)
    expect(item_categories.map((category): string | null => craft_job_of(category))).toEqual(
      item_categories.map((category) => move_jobs.get(category) ?? null)
    )
    // A fixed category overrides the authored job; an ambiguous one keeps it.
    expect([craft_job_of('sword', 'FARMER'), craft_job_of('consumable', 'FARMER')]).toEqual(['FORGER', 'FARMER'])

    expect([craft_batch_limit('resource'), craft_batch_limit('hat')]).toEqual([1_000, 1])
    const batch = move_source('move-math/sources/craft_batch.move')
    expect(batch).toContain('MAX_STACKABLE_ATTEMPTS: u16 = 1_000')
    expect(batch).toContain('MAX_UNIQUE_ATTEMPTS: u16 = 1')
    expect(move_source('move/sources/crafting.move')).toContain('craft_batch::shape(')
  })

  test('equipment slots accept their own categories and cosmetics override appearance independently', () => {
    expect(
      ['daggers', 'spear', 'bow', 'axe', 'sword'].every((category) => equipment_slot_accepts('weapon', category))
    ).toBeTrue()
    expect(rig_slots).toContain('tool')
    expect([equipment_slot_accepts('tool', 'tool_miner'), equipment_slot_accepts('weapon', 'hat')]).toEqual([
      true,
      false,
    ])
    for (const slot of cosmetic_slots) {
      expect([is_item_category(slot), is_cosmetic_category(slot), item_is_stackable(slot)]).toEqual([true, true, false])
      expect(['hat', 'cloak', slot].map((category) => equipment_slot_accepts(slot, category))).toEqual([
        false,
        false,
        true,
      ])
      expect((['hat', 'cloak'] as const).map((other) => equipment_slot_accepts(other, slot))).toEqual([false, false])
    }
    expect(equipment_slot_accepts('cosmetic_hat', 'cosmetic_cloak')).toBeFalse()
    const equipped = { hat: 'stat_hat', cloak: 'stat_cloak', cosmetic_hat: 'pepe', cosmetic_cloak: 'cape' }
    expect(worn_appearance(equipped)).toEqual({ hat: 'pepe', cloak: 'cape' })
    expect(worn_appearance({ ...equipped, hat: 'new_hat', cosmetic_hat: null })).toEqual({
      hat: 'new_hat',
      cloak: 'cape',
    })
    expect(worn_appearance({ ...equipped, cosmetic_cloak: null })).toEqual({ hat: 'pepe', cloak: 'stat_cloak' })
    expect(worn_appearance({})).toEqual({ hat: null, cloak: null })
  })

  test('gatherables own job, tier, protector and rare identity, and gathering checks level before tool', () => {
    expect(gatherable_catalog).toHaveLength(33)
    expect(new Set(gatherable_catalog.map(({ item_type }) => item_type)).size).toBe(33)
    expect(
      ['FARMER', 'HERBALIST', 'MINER'].map((job) =>
        gatherable_catalog.filter((row) => row.job === job).map(({ tier }) => tier)
      )
    ).toEqual([0, 1, 2].map(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
    expect(gatherable_of('wheat')).toEqual({
      item_type: 'wheat',
      job: 'FARMER',
      tier: 1,
      protector: 'protector_wheat_bricheton',
      rare_item_type: 'golden_wheat',
    })
    expect(gatherable_of('golden_wheat')).toBeNull()
    expect(rare_pet_food_tier(['golden_wheat', 'golden_mushroom', 'infinity_quartz'])).toBe(1)
    expect(rare_pet_food_tier(['golden_wheat', 'golden_mushroom', 'infinity_amber'])).toBeNull()

    const resource = { job: 'MINER', tier: 2 }
    expect(gather_gate({ jobs: {}, equipment: [] }, resource)).toMatchObject({ ok: false, reason: 'level' })
    const jobs = { MINER: job_xp_for_level(100)! }
    const wrong_tool = { jobs, equipment: [{ slot: 'tool', category: 'tool_farmer' }] }
    expect(gather_gate(wrong_tool, resource)).toEqual({ ok: false, reason: 'tool', job: 'MINER' })
    expect(gather_gate({ jobs, equipment: [{ slot: 'tool', category: 'tool_miner' }] }, resource)).toEqual({ ok: true })
  })

  test('model variants, archimobs and world coordinates resolve without guessing', () => {
    const models = ['aragne', 'cro', 'cro_wani', 'protector_gaia', 'protector_bricheton', 'protector_miner']
    const identities = [
      ['aragne__fire', 'aragne', 'fire'],
      ['cro_wani__white', 'cro_wani', 'white'],
      ['cro_wani', 'cro_wani', null],
      ['protector_shrooms_gaia', 'protector_gaia', 'shrooms'],
      ['protector_wheat_bricheton', 'protector_bricheton', 'wheat'],
      ['protector_cursed_gem', 'protector_miner', 'cursed_gem'],
      ['protector_miner__quartz', 'protector_miner', 'quartz'],
    ] as const
    for (const [name, basename, variant] of identities)
      expect(model_variant_identity(name, models)).toEqual({ basename, variant })
    for (const name of ['cro_wani_white', 'missing__fire', 'protector_', 'protector_quartz__extra'])
      expect(model_variant_identity(name, models)).toBeNull()
    expect(model_variant_identity('protector_quartz', ['aragne'])).toBeNull()

    const mobs = [
      { mob_type: 'fuwa', family: 'fuwa', role: 'normal' },
      { mob_type: 'nifuwa', family: 'fuwa', role: 'normal' },
      { mob_type: 'fukuo', family: 'fuwa', role: 'archi' },
      { mob_type: 'boss', family: 'fuwa', role: 'boss' },
    ]
    expect(archimob_rows(mobs, ['fuwa', 'nifuwa', 'boss', 'fuwa'])).toEqual([
      { ordinary_type: 'fuwa', archi_type: 'fukuo' },
      { ordinary_type: 'nifuwa', archi_type: 'fukuo' },
    ])
    expect([chain_to_client_coordinate(50_000), chain_to_client_coordinate(50_012.25)]).toEqual([0, 12.25])
    expect(client_to_chain_coordinate(-12.25)).toBe(49_987.75)
  })

  test('SuiNS names display relative to the app namespace and classify agents exactly', () => {
    const names = [
      ['sceat.sui', '@sceat'],
      ['child.sceat.sui', '@child.sceat'],
      ['sceat.sceat.sui', '@sceat.sceat'],
      ['child@sceat', '@child.sceat'],
      ['aresrpg.child.sceat.sui', '@child.sceat'],
      ['aresrpgagent.child.sceat.sui', '@child.sceat'],
      ['otheraresrpg.sceat.sui', '@otheraresrpg.sceat'],
      ['@Sceat', '@sceat'],
    ]
    for (const [name, shown] of names) expect(display_suins_name(name!)).toBe(shown!)
    expect(application_suins_name('aresrpgagent.child@sceat')).toEqual({ kind: 'agent', parent: 'child.sceat.sui' })
    expect(application_suins_name('aresrpg.sceat.sui')).toEqual({ kind: 'player', parent: 'sceat.sui' })
    expect(application_suins_name('otheraresrpgagent.sceat.sui')).toBeNull()
    expect(canonical_suins_name(' CHILD@SCEAT ')).toBe('child.sceat.sui')
    expect([chat_suins_prefix('aresrpg.child.sceat.sui'), chat_suins_prefix(null)]).toEqual(['(@child.sceat) ', ''])
  })

  test('a roll is exceptional strictly above 90%, penalties improve towards zero, and missing rolls fail', () => {
    const ranges = {
      min: { vitality: 10, intelligence: 10, action: 1 },
      max: { vitality: 110, intelligence: 20, action: 1 },
    }
    expect(roll_quality(ranges, { vitality: 90, intelligence: 20, action: 1 })).toEqual({
      basis_points: 9000,
      exceptional: false,
    })
    expect(roll_quality(ranges, { vitality: 91, intelligence: 20, action: 1 })).toEqual({
      basis_points: 9050,
      exceptional: true,
    })
    expect(roll_quality({ min: { vitality: -20 }, max: { vitality: -10 } }, { vitality: -10 })?.exceptional).toBeTrue()
    expect(roll_quality({ min: { vitality: 10 }, max: { vitality: 10 } }, { vitality: 10 })).toBeNull()
    const even = { min: { vitality: 0, action: 0 }, max: { vitality: 1000, action: 1 } }
    expect(roll_quality(even, { vitality: 1000, action: 0 })?.basis_points).toBe(5000)
    expect(() => roll_quality(even, { vitality: 1000 })).toThrow('Invalid item roll')
  })

  test('backend locale projections keep only the fields their consumers read, merge aliases included', () => {
    const document = {
      allocation_page: { title: 'Allocation' },
      discord_marketplace: { title: 'Market' },
      simulator_page: { stat_health: 'Health', unused_label: 'Browser only' },
      ui: { agent_pair_no_assets: 'Browser only' },
    }
    expect(allocation_locale(document)).toEqual({ title: 'Allocation' })
    expect(notification_locale(document)).toEqual({ copy: { title: 'Market' }, stats: { health: 'Health' } })
    const yaml = Bun.YAML.parse(`copy: &copy
  title: Original
allocation_page:
  <<: *copy
discord_marketplace:
  title: Shadowed
  title: Actual
simulator_page:
  stat_health: Health
`) as Parameters<typeof notification_locale>[0] & { allocation_page: { title: string } }
    expect(allocation_locale(yaml)).toEqual({ title: 'Original' })
    expect(notification_locale(yaml)).toEqual({ copy: { title: 'Actual' }, stats: { health: 'Health' } })
  })
})

describe('published allocations', () => {
  test('awards publish only public fields, caps are exact, and the CSV and share links stay stable', () => {
    const address = (value: number): string => normalize_address(`0x${value.toString(16)}`)
    const private_row = {
      address: address(1),
      tier: 'veteran',
      source: 'manual',
      evidence: 'private operator note',
    } as const
    expect(public_award(private_row)).toEqual({ address: address(1), tier: 'veteran', source: 'reserved' })
    expect(public_award({ ...private_row, source: 'leaderboard', evidence: 'xp:12' })).toEqual({
      address: address(1),
      tier: 'veteran',
      source: 'leaderboard',
      board: 'xp',
    })
    expect([cap_mist('veteran'), cap_mist('member')]).toEqual([125_000_000_000n, 70_000_000_000n])
    expect(sui_amount(cap_mist('member'))).toBe('70')
    expect(blast_csv([{ address: '0x1', tier: 'veteran', source: 'manual', evidence: '=unsafe' }])).toBe(
      `address,cap_sui,cap_mist\n${address(1)},125,125000000000\n`
    )
    expect(() => blast_csv([{ address: '=unsafe', tier: 'member', source: 'social', evidence: '' }])).toThrow(
      'invalid_address'
    )
    const twice = { address: '0x1', tier: 'member', source: 'social', evidence: '' } as const
    expect(() => blast_csv([twice, { ...twice, address: '0x01' }])).toThrow('duplicate_address')
    expect(share_version({ tier: 'veteran' })).toBe(
      'voxel-bank-v2-2026-10-28T15:00:00Z-final-veteran-125000000000-833333'
    )
    expect(share_version({ tier: 'member' })).toBe('voxel-bank-v2-2026-10-28T15:00:00Z-final-member-70000000000-466667')
    expect(share_version()).toBe('voxel-bank-v2-2026-10-28T15:00:00Z-final-pending-0-0')
  })
})
