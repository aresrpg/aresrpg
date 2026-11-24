// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Professions, items, growth, loot boxes and hero creation through the SDK doors.
import { expect, test, describe } from 'bun:test'
import {
  characteristic_spending_quote,
  type CharacteristicName,
  item_stat_center,
  stat_names,
  type StatName,
} from '@aresrpg/immutable'
import { item_template_id } from '@aresrpg/sdk/seed-ids'
import { living_content } from '@aresrpg/sdk/pins'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { equip_refusal } from '@aresrpg/protocol/equipment'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { CHARACTER_FUNDING_MIST, GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'
import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'

import { parse_gameplay_action, execute_gameplay_actions } from '../src/gameplay.ts'
import { select_spending, type SpendAction } from '../src/behavior_plan.ts'
import items from '../../../seed/content/items.json'
import { id, pins as base_pins } from '../../sdk/test/helpers/transport.ts'
import { bind_action_baseline, action_projected } from '../src/action_reconciliation.ts'
import type { GameplayContext } from '../src/gameplay_context.ts'
import { select_owned_item, type EquipOwnedAction } from '../src/behavior_items.ts'
import { equipment_projected } from '../src/equipment_actions.ts'
import { public_command_error } from '../src/planning_failure.ts'

import { archer_build as build, archer_build } from './fixture_fight.ts'
import { profession_context, character, item, plan_of } from './fixture_game.ts'

describe('loot boxes', () => {
  const context = () => {
    const base = profession_context()
    const bag = { ...item('bag_aloe_vera', 2), category: 'consumable' }
    return {
      ...base,
      command: {
        ...base.command,
        kind: 'open_loot_boxes' as const,
        payload: { character_id: character.id, item_id: bag.id, count: 2 },
      },
      snapshot: { ...base.snapshot, inventory: { ...base.snapshot.inventory!, items: [bag] } },
    }
  }
  test('resource bags use the existing SDK opening action with exact kiosk custody', async () => {
    const f = context()
    expect(parse_gameplay_action('open_loot_boxes', f.command.payload)).toEqual(f.command.payload)
    const plan = plan_of(f)
    expect(plan).toMatchObject({
      kind: 'open_loot_boxes',
      input: {
        box_item_type: 'bag_aloe_vera',
        count: 2,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      },
    })
    const inputs: unknown[] = []
    await execute_gameplay_actions(f, {
      open_loot_boxes: async (input: unknown) => {
        inputs.push(input)
        return { digest: 'fixture' }
      },
    } as never)
    expect(inputs).toEqual([plan.input])
  })

  const pins = { ...base_pins, content_root: { id: id(200) }, seed_package_original: id(201) }
  const content = living_content({ pins }, 'fixture')
  const template = (name: string) => item_template_id(content.content_root, content.seed_package_original, name)
  const claim = { id: id(40), kind: 'box' as const, rolled_template: template('aloe_vera'), amount: 50 }
  const claim_context = () => {
    const f = context()
    return {
      ...f,
      pins,
      command: {
        ...f.command,
        kind: 'claim_loot' as const,
        payload: { character_id: character.id, claim_ids: [claim.id] },
      },
      snapshot: { ...f.snapshot, inventory: { ...f.snapshot.inventory, claims: [claim] } },
    }
  }
  test('opening refuses stale, foreign, listed, non-box and insufficient inventory', () => {
    const f = context()
    expect(() => plan_of({ ...f, command: { ...f.command, observation_revision: 0 } })).toThrow('needs_resync')
    expect(() => plan_of({ ...f, snapshot: { ...f.snapshot, characters: [] } })).toThrow('authority')
    for (const patch of [
      { kiosk: id(90) },
      { category: 'resource' },
      { item_type: 'aloe_vera' },
      { version: undefined },
    ])
      expect(() =>
        plan_of({
          ...f,
          snapshot: {
            ...f.snapshot,
            inventory: { ...f.snapshot.inventory, items: [{ ...f.snapshot.inventory.items[0]!, ...patch }] },
          },
        })
      ).toThrow('loot_box_unavailable')
    expect(() => plan_of({ ...f, command: { ...f.command, payload: { ...f.command.payload, count: 3 } } })).toThrow(
      'insufficient_loot_boxes'
    )
    expect(() =>
      plan_of({
        ...f,
        snapshot: {
          ...f.snapshot,
          inventory: { ...f.snapshot.inventory, listings: [{ id: f.command.payload.item_id } as never] },
        },
      })
    ).toThrow('loot_box_unavailable')
  })
  test('collection resolves only owned projected claims and uses the SDK batch action', async () => {
    const f = claim_context()
    for (const claims of [null, [], [{ ...claim, kind: 'crush' as const }], [{ ...claim, rolled_template: id(999) }]])
      expect(() =>
        plan_of({ ...f, snapshot: { ...f.snapshot, inventory: { ...f.snapshot.inventory, claims } } })
      ).toThrow('loot_claim_unavailable')
    const plan = plan_of(f)
    expect(plan).toMatchObject({
      kind: 'claim_loot',
      input: { claims: [{ claim_id: claim.id, rolled_item_type: 'aloe_vera', existing: null }] },
    })
    const inputs: unknown[] = []
    await execute_gameplay_actions(f, {
      claim_loot_batch: async (input: unknown) => {
        inputs.push(input)
        return { digest: 'fixture' }
      },
    } as never)
    expect(inputs).toEqual([plan.input])
  })
  test('opening and collection wait for both receipt-proven inventory and indexed claims', () => {
    const f = context()
    const bag = f.snapshot.inventory.items[0]!
    const receipt = {
      Transaction: {
        digest: 'D',
        effects: { lamportVersion: '2', changedObjects: [{ objectId: bag.id, outputVersion: '2' }] },
        objectTypes: { [bag.id]: 'fixture::item::Item' },
        events: [
          { type: 'fixture::item::AmountChanged', json: { item: bag.id, amount: 0 } },
          { type: 'fixture::loot_box::LootBoxesOpened', json: { claim_ids: [claim.id, id(41)] } },
        ],
      },
    }
    const command = bind_action_baseline({ ...f.command, status: 'completed', result: { digest: 'D' } }, f)
    const projected = {
      ...f,
      snapshot: {
        ...f.snapshot,
        inventory: {
          ...f.snapshot.inventory,
          claims: [claim, { ...claim, id: id(41) }],
          items: [],
          removed: { [bag.id]: '2' },
        },
      },
    }
    expect(action_projected(command, receipt, f)).toBe(false)
    expect(
      action_projected(command, receipt, {
        ...projected,
        snapshot: { ...projected.snapshot, inventory: f.snapshot.inventory },
      })
    ).toBe(false)
    expect(
      action_projected(command, receipt, {
        ...projected,
        snapshot: { ...projected.snapshot, inventory: { ...projected.snapshot.inventory, claims: null } },
      })
    ).toBe(false)
    expect(action_projected(command, receipt, projected)).toBe(true)
    expect(action_projected({ ...command, status: 'uncertain' }, receipt, projected)).toBe(false)
    const c = claim_context()
    const collected = bind_action_baseline({ ...c.command, status: 'completed', result: { digest: 'C' } }, c)
    const reward = { ...item('aloe_vera', 50, 42), version: '3' }
    const collection = {
      Transaction: {
        digest: 'C',
        effects: { lamportVersion: '3', changedObjects: [{ objectId: reward.id, outputVersion: '3' }] },
        objectTypes: { [reward.id]: 'fixture::item::Item' },
        events: [{ type: 'fixture::loot_box::LootClaimed', json: {} }],
      },
    }
    const done = {
      ...c,
      snapshot: { ...c.snapshot, claims: [], inventory: { ...c.snapshot.inventory, claims: [], items: [reward] } },
    }
    expect(action_projected(collected, collection, c)).toBe(false)
    expect(
      action_projected(collected, collection, {
        ...done,
        snapshot: { ...done.snapshot, inventory: { ...done.snapshot.inventory, claims: [claim] } },
      })
    ).toBe(false)
    expect(action_projected(collected, collection, done)).toBe(true)
  })
})

describe('raise stats', () => {
  const context = () => {
    const base = profession_context()
    return {
      ...base,
      command: {
        ...base.command,
        kind: 'raise_stats' as const,
        payload: { character_id: character.id, spending: { vitality: 5 } },
      },
      snapshot: { ...base.snapshot, characters: [{ ...character, classe: 'ikari', available_points: 5 }] },
    }
  }

  test('stat admission rejects stale observations, foreign/fight custody, unavailable points and unusable class-cost remainders', () => {
    const f = context()
    expect(() => plan_of({ ...f, snapshot: { ...f.snapshot, ready: false } })).toThrow('needs_resync')
    expect(() => plan_of({ ...f, command: { ...f.command, observation_revision: 0 } })).toThrow('needs_resync')
    expect(() => plan_of({ ...f, snapshot: { ...f.snapshot, characters: [] } })).toThrow('authority')
    const change = (row: Partial<typeof character>) => ({
      ...f,
      snapshot: { ...f.snapshot, characters: [{ ...f.snapshot.characters[0]!, ...row }] },
    })
    expect(() => plan_of(change({ custody: 'fight' }))).toThrow('not_available')
    expect(() => plan_of(change({ kiosk_cap: undefined }))).toThrow('custody_resync')
    expect(() => plan_of(change({ available_points: 4 }))).toThrow('insufficient_character_points')
    expect(() => plan_of(change({ vitality: 65530 }))).toThrow('invalid_stat_spending')
    expect(() =>
      plan_of({
        ...f,
        command: { ...f.command, payload: { character_id: character.id, spending: { wisdom: 5 } } },
      })
    ).toThrow('invalid_stat_spending')
  })
  test('receipt completion waits for the exact indexed natural stats and spent capital, including Ikari double vitality', () => {
    const f = context()
    const command = bind_action_baseline({ ...f.command, status: 'completed', result: { digest: 'D' } }, f)
    const receipt = { Transaction: { digest: 'D' } }
    expect(action_projected(command, receipt, f)).toBe(false)
    const observed = (vitality: number, available_points: number) => ({
      ...f,
      snapshot: { ...f.snapshot, characters: [{ ...f.snapshot.characters[0]!, vitality, available_points }] },
    })
    expect(action_projected(command, receipt, observed(5, 0))).toBe(false)
    expect(action_projected(command, receipt, observed(10, 5))).toBe(false)
    expect(action_projected(command, receipt, observed(10, 0))).toBe(true)
    expect(action_projected(command, { Transaction: { digest: 'other' } }, observed(10, 0))).toBe(false)
    expect(action_projected({ ...command, status: 'uncertain' }, receipt, observed(10, 0))).toBe(false)
    expect(observed(10, 0).snapshot.characters[0]!.spells).toEqual(f.snapshot.characters[0]!.spells)
  })
})

describe('raise spell', () => {
  const context = () => {
    const base = profession_context()
    return {
      ...base,
      command: {
        ...base.command,
        kind: 'raise_spell' as const,
        payload: { character_id: character.id, spell: 'Tricky Trap' },
      },
      snapshot: { ...base.snapshot, characters: [{ ...character, classe: 'yajin', available_spell_points: 5 }] },
    }
  }
  test('spell admission rejects stale, foreign, fight-held, locked, capped and unaffordable upgrades', () => {
    const f = context()
    expect(() => plan_of({ ...f, snapshot: { ...f.snapshot, ready: false } })).toThrow('needs_resync')
    expect(() => plan_of({ ...f, command: { ...f.command, observation_revision: 0 } })).toThrow('needs_resync')
    expect(() => plan_of({ ...f, snapshot: { ...f.snapshot, characters: [] } })).toThrow('authority')
    const change = (row: Partial<typeof character>) => ({
      ...f,
      snapshot: { ...f.snapshot, characters: [{ ...f.snapshot.characters[0]!, ...row }] },
    })
    expect(() => plan_of(change({ custody: 'fight' }))).toThrow('not_available')
    expect(() => plan_of(change({ kiosk_cap: undefined }))).toThrow('custody_resync')
    expect(() => plan_of(change({ classe: 'asobi' }))).toThrow('spell_not_learned')
    expect(() =>
      plan_of({ ...f, command: { ...f.command, payload: { ...f.command.payload, spell: 'Lethal Trap' } } })
    ).toThrow('spell_not_learned')
    expect(() => plan_of(change({ spells: { 'Tricky Trap': 6 } }))).toThrow('spell_rank_capped')
    expect(() => plan_of(change({ spells: { 'Tricky Trap': 3 }, available_spell_points: 2 }))).toThrow(
      'insufficient_spell_points'
    )
    expect(() => plan_of(change({ available_spell_points: NaN }))).toThrow('needs_resync')
    for (const payload of [
      { character_id: character.id, spell: '' },
      { character_id: character.id, spell: 'Tricky Trap', rank: 6 },
    ])
      expect(() => parse_gameplay_action('raise_spell', payload)).toThrow('invalid_gameplay_payload')
    expect(() => parse_gameplay_action('raise_spell', { character_id: character.id, spell: 'invented' })).toThrow(
      'unknown_combat_spell'
    )
  })
})

describe('behavior growth', () => {
  const [arrow, range, critical, power] = build.spells!
  const spend = (hero: CharacterRow): SpendAction => ({
    type: 'spend_points',
    character_id: hero.id,
    stats: build.stats as readonly CharacteristicName[],
    spells: build.spells!,
  })
  const context_of = (hero: CharacterRow): GameplayContext => {
    const base = profession_context()
    return { ...base, snapshot: { ...base.snapshot, characters: [hero] } }
  }
  type Payload = Readonly<{ spending?: Readonly<Record<string, number>>; spell?: string }>
  /** What the chain does with one spending command: the class ladder for stats, one rank for a spell. */
  const applied = (hero: CharacterRow, { spending, spell }: Payload): CharacterRow => {
    if (spending) {
      const quote = characteristic_spending_quote('yogan', hero, spending)!
      const intelligence = hero.intelligence + quote.gains.intelligence
      return { ...hero, intelligence, available_points: hero.available_points - quote.cost }
    }
    const rank = hero.spells[spell!] ?? 1
    return {
      ...hero,
      spells: { ...hero.spells, [spell!]: rank + 1 },
      available_spell_points: hero.available_spell_points - rank,
    }
  }
  /** Spend until the leaf has nothing left to do, recording what it chose. */
  const spent = (hero: CharacterRow, log: Payload[]): CharacterRow => {
    const context = context_of(hero)
    const selection = select_spending(spend(hero), context)
    if (selection.status !== 'action') return hero
    // Every choice is one the bot's own validator accepts as a command.
    plan_of({ ...context, command: { ...context.command, ...selection.action } })
    const payload = selection.action.payload as Payload
    log.push(payload)
    return spent(applied(hero, payload), log)
  }
  /** Each level grants five stat points and, from level two, one spell point. */
  const level_up = (hero: CharacterRow): CharacterRow => ({
    ...hero,
    level: hero.level + 1,
    available_points: hero.available_points + 5,
    available_spell_points: hero.available_spell_points + 1,
  })

  test('the archer build puts every stat point in intelligence and maxes Magic Arrow before any buff', () => {
    const log: Payload[] = []
    const start: CharacterRow = { ...character, classe: 'yogan', level: 1 }
    const hero = Array.from({ length: 49 }).reduce<CharacterRow>((current) => spent(level_up(current), log), start)
    expect(hero.level).toBe(50)
    // Stats: only intelligence, and never a point left that pays for another step.
    expect(log.flatMap(({ spending }) => (spending ? Object.keys(spending) : []))).toContain('intelligence')
    expect(new Set(log.flatMap(({ spending }) => (spending ? Object.keys(spending) : [])))).toEqual(
      new Set(['intelligence'])
    )
    expect(hero.intelligence).toBe(50 + (49 * 5 - 50 - hero.available_points) / 2)
    expect(hero.available_points).toBeLessThan(2)
    // Spells: strict priority. A buff learned at level 9 waits until Magic Arrow has its last rank.
    const ranks = (spell: string | undefined, count: number) => Array<string>(count).fill(spell!)
    expect(log.flatMap(({ spell }) => (spell ? [spell] : []))).toEqual([
      ...ranks(arrow, 5),
      ...ranks(range, 5),
      ...ranks(critical, 5),
      ...ranks(power, 2),
    ])
    expect(hero.spells).toEqual({ [arrow!]: 6, [range!]: 6, [critical!]: 6, [power!]: 3 })
  })

  /** A real fight of the twin: an archer of the given level three cells from one mob. */
})

describe('behavior items', () => {
  const priority: readonly StatName[] = archer_build.equipment
  const best = (slot: EquipOwnedAction['slot'] = 'hat', stats = priority): EquipOwnedAction => ({
    type: 'equip_owned',
    character_id: character.id,
    slot,
    order: 'best_stats',
    stats,
  })

  /** A real seed item as the bot observes it once owned: its best authored roll, or the given bonuses. */
  const owned = (item_type: string, number: number, bonuses?: Partial<Record<StatName, number>>): ItemRow => {
    const seed = items.find((row) => row.item_type === item_type)!
    const rolled = { ...(seed.stats!.max as Record<StatName, number>), ...bonuses }
    return {
      id: id(number),
      item_type,
      name: seed.name,
      category: seed.category,
      level: seed.level,
      amount: 1,
      kiosk: character.kiosk,
      version: '1',
      stats: Object.fromEntries(stat_names.map((stat) => [stat, item_stat_center + rolled[stat]])),
    }
  }
  const context_of = (
    items: readonly ItemRow[],
    hero: Partial<CharacterRow> = {},
    bag: object = {}
  ): GameplayContext => {
    const base = profession_context()
    const inventory = { ...base.snapshot.inventory!, items, ...bag }
    return { ...base, snapshot: { ...base.snapshot, characters: [{ ...character, level: 12, ...hero }], inventory } }
  }
  const chosen = (context: GameplayContext, action = best()) => {
    const selection = select_owned_item(action, context)
    if (selection.status !== 'action') return selection
    // Every choice is one the bot's own equip validator accepts as a command.
    plan_of({ ...context, command: { ...context.command, ...selection.action } })
    return selection.action.payload.item_id
  }
  const NOTHING = { status: 'failure', code: 'item_unavailable' } as const

  // Real seed hats: intelligence 20, vitality 60, wisdom 20, strength 20, then intelligence 40 with strength.
  const [smart, sturdy, wise, strong, white] = [
    owned('lorito_hat__intelligence', 41),
    owned('lorito_hat__vitality', 42),
    owned('lorito_hat__wisdom', 43),
    owned('lorito_hat__strength', 44),
    owned('coiffe_fuwa__white', 45),
  ]

  test('the best owned item of a slot is ranked by the authored stats, intelligence first', () => {
    expect(chosen(context_of([strong, wise, sturdy, smart, white]))).toBe(white.id)
    // One point of intelligence outweighs any amount of a later stat.
    expect(chosen(context_of([wise, sturdy, owned('lorito_hat__intelligence', 46, { intelligence: 1 })]))).toBe(id(46))
    expect(chosen(context_of([strong, wise, sturdy]))).toBe(sturdy.id)
    expect(chosen(context_of([strong, wise]))).toBe(wise.id)
    // Equal on the first stat: the next listed stat decides, then the lowest id.
    const golden = owned('lorito_hat__golden', 47, { intelligence: 20, vitality: 30 })
    expect(chosen(context_of([smart, golden], { level: 16 }))).toBe(golden.id)
    expect(chosen(context_of([owned('lorito_hat__intelligence', 49), smart]))).toBe(smart.id)
    // An item with none of the listed stats, or one that lowers the first, never beats an empty slot.
    expect(chosen(context_of([strong]))).toEqual(NOTHING)
    expect(chosen(context_of([owned('drakar', 48)], { level: 30 }))).toEqual(NOTHING)
  })

  test('a worn item is replaced only by a strictly better one: never a downgrade, never a swap of equals', () => {
    const wearing = (item: ItemRow) => ({ equipment: [{ ...item, slot: 'hat' }] })
    expect(chosen(context_of([white, sturdy], wearing(smart)))).toBe(white.id)
    expect(chosen(context_of([smart, sturdy, wise, strong], wearing(white)))).toEqual(NOTHING)
    expect(chosen(context_of([owned('lorito_hat__intelligence', 49)], wearing(smart)))).toEqual(NOTHING)
    // The same hat already worn in the slot is success for an exact order and nothing better for a ranked one.
    expect(chosen(context_of([], wearing(smart)))).toEqual(NOTHING)
  })
})

describe('equipment actions', () => {
  const validate_equip_item = (context: GameplayContext) =>
    plan_of({ ...context, command: { ...context.command, kind: 'equip_item' } })
  const hat = { ...item('fixture_hat', 1, 70), category: 'hat' }
  const heal = items.find((row) => row.consumable?.type === 'heal')!
  const potion = { ...item(heal.item_type, 2, 71), category: 'consumable' }
  const context_for = (kind: GameplayContext['command']['kind'], payload: Record<string, unknown>) => {
    const context = profession_context()
    return {
      ...context,
      command: { ...context.command, kind, payload },
      snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: [hat, potion] } },
    }
  }
  test('general equipment preserves canonical slot, level, duplicate relic and encumbrance refusals', () => {
    const base = {
      item: hat,
      slot: 'hat' as const,
      character_level: character.level,
      equipment: {},
      listed_ids: new Set<string>(),
    }
    expect(equip_refusal(base)).toBeNull()
    expect(equip_refusal({ ...base, slot: 'boots' })).toBe('wrong_slot')
    expect(equip_refusal({ ...base, character_level: 0 })).toBe('level_too_low')
    expect(equip_refusal({ ...base, listed_ids: new Set([hat.id]) })).toBe('item_listed')
    const relic = { ...hat, category: 'relic' }
    expect(
      equip_refusal({ ...base, item: relic, slot: 'relic_2', equipment: { relic_1: { ...relic, slot: 'relic_1' } } })
    ).toBe('relic_duplicate')
  })
  test('dynamic equipment resolves current item identity and ordinary validator constructs atomic replacement', () => {
    const payload = { character_id: character.id, item_id: hat.id, slot: 'hat' as const }
    const context = context_for('equip_item', payload)
    const selected = select_owned_item(
      { type: 'equip_owned', character_id: character.id, item_type: hat.item_type, slot: 'hat', order: 'lowest_id' },
      context
    )
    expect(selected).toEqual({ status: 'action', action: { kind: 'equip_item', payload } })
    expect(validate_equip_item(context).input.to_equip).toEqual([{ item_id: hat.id, slot: 'hat' }])
    const equipped = { ...character, equipment: [...character.equipment, { ...hat, slot: 'hat' }] }
    expect(equipment_projected(payload, equipped)).toBe(true)
    expect(
      select_owned_item(
        { type: 'equip_owned', character_id: character.id, item_type: hat.item_type, slot: 'hat', order: 'lowest_id' },
        { ...context, snapshot: { ...context.snapshot, characters: [equipped] } }
      )
    ).toEqual({ status: 'success' })
  })
  test('an equip without an item empties the slot with one unequip, and an empty slot is refused', async () => {
    const worn = { ...character, equipment: [...character.equipment, { ...hat, slot: 'hat' }] }
    const payload = { character_id: character.id, slot: 'hat' as const }
    expect(parse_gameplay_action('equip_item', payload)).toEqual(payload)
    expect(() => parse_gameplay_action('equip_item', { character_id: character.id })).toThrow(
      'invalid_gameplay_payload'
    )
    expect(() => parse_gameplay_action('equip_item', { ...payload, item_id: null })).toThrow('invalid_gameplay_payload')
    const base = context_for('equip_item', payload)
    const context = { ...base, snapshot: { ...base.snapshot, characters: [worn] } }
    expect(validate_equip_item(context).input).toEqual({
      character_id: character.id,
      custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap! },
      to_equip: [],
      to_unequip: [{ slot: 'hat', item_id: hat.id }],
    })
    const calls: unknown[] = []
    await execute_gameplay_actions(context, {
      equip: async (input: unknown) => {
        calls[calls.length] = input
        return { digest: 'fixture' }
      },
    } as unknown as Parameters<typeof execute_gameplay_actions>[1])
    expect(calls).toEqual([validate_equip_item(context).input])
    // The certified effect: the slot is empty. A worn slot is not yet the projection.
    expect(equipment_projected(payload, worn)).toBe(false)
    expect(equipment_projected(payload, character)).toBe(true)
    expect(() => validate_equip_item(base)).toThrow('slot_empty')
    for (const busy of [{ custody: 'fight' as const }, { ambush: { fired: true } as never }])
      expect(() =>
        validate_equip_item({ ...context, snapshot: { ...context.snapshot, characters: [{ ...worn, ...busy }] } })
      ).toThrow('character_not_available')
    expect(() => validate_equip_item({ ...context, snapshot: { ...context.snapshot, characters: [] } })).toThrow(
      'character_authority_mismatch'
    )
  })
})

describe('character actions', () => {
  const validate_create_character = (context: GameplayContext) =>
    plan_of({ ...context, command: { ...context.command, kind: 'create_character' } })
  const payload = { name: 'Newhero', classe: 'senshi', male: false, color_1: 0, color_2: 0xd9af57, color_3: 0xffffff }
  const balance = (mist: bigint) => ({ address: id(99), balance_mist: String(mist), sampled_at: 0, expires_at: 1e9 })
  const context_for = (patch: Readonly<Record<string, unknown>> = {}, funds = CHARACTER_FUNDING_MIST) => {
    const context = profession_context()
    return {
      ...context,
      balance: balance(funds),
      command: { ...context.command, kind: 'create_character' as const, payload: { ...payload, ...patch } },
    }
  }

  test('the wallet must hold the price and the gas ceiling, and the refusal is the existing funding refusal', () => {
    expect(CHARACTER_FUNDING_MIST).toBe(CHARACTER_PRICE_MIST + GAS_BUDGET_MIST)
    expect(CHARACTER_PRICE_MIST).toBe(10_000_000_000n)
    expect(validate_create_character(context_for()).kind).toBe('create_character')
    const short = context_for({}, CHARACTER_FUNDING_MIST - 1n)
    const refusal = (() => {
      try {
        validate_create_character(short)
      } catch (error) {
        return error
      }
      return null
    })()
    expect(transaction_failure_kind(refusal)).toBe('funding')
    // What the client reads once the bot stores that refusal on the command.
    expect(public_command_error('failed', String(refusal))).toBe('funding_required')
    // An unread balance decides nothing here: the SDK's own preparation stays the authority.
    expect(validate_create_character({ ...short, balance: null }).kind).toBe('create_character')
  })
})
