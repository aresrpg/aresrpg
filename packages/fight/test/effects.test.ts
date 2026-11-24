// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One cast through the real resolver: legality, entropy, effects, and the projections that read it.

import { describe, expect, test } from 'bun:test'

import { encode_cell, zone_cells, zone_rank } from '../src/combat_grid.ts'
import { effect_seed } from '../src/fight_math.ts'
import {
  create_fight,
  preview_spell_cast,
  preview_weapon_strike,
  project_spell_turn,
  project_weapon_turn,
  spell_area_cells,
  spell_effect_area_cells,
  spell_level_of,
  spell_target_cells,
  weapon_area_cells,
  weapon_target_cells,
  fighter_resistances,
  type HydratedFightCheckpoint,
  type MobFighter,
  type SpellEffect,
  type SpellLevel,
} from '../src/index.ts'
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '../src/move_contract.gen.ts'
import { draw } from '../src/prng.ts'

import { active, effect_row, fixture, open_fixture, spell_level, started, with_spells } from './helpers.ts'

const ranged = (kind: bigint, stat: bigint, overrides: Partial<SpellEffect> = {}): SpellEffect =>
  effect_row({ kind, stat, element: '', value: 2n, value_max: 30n, target_filter: 1n, turns: 2n, ...overrides })

/** Seat 0 at cell 100 and the mob at 105 on an open board, mid-turn with a known seed: no start, no refill. */
const in_turn = (checkpoint: HydratedFightCheckpoint = open_fixture(), turn_seed = 7n) => {
  checkpoint.contract.fighters[0]!.cell = 100n
  checkpoint.contract.fighters[1]!.cell = 105n
  Object.assign(checkpoint.contract, {
    round: 1n,
    queue: checkpoint.contract.fighters.map((_, seat) => BigInt(seat)),
    turn_ptr: 0n,
    turn_seed,
    turn_slot: 0n,
  })
  checkpoint.contract.fighters[0]!.ap = 6n
  return create_fight({ state: checkpoint, mode: 'local', seed: 91n })
}

const cast = (fight: ReturnType<typeof create_fight>, spell: string, target_cell: bigint) =>
  fight.apply({ type: 'cast_spell', fighter: 0n, spell, target_cell })

/** Each draw of a stream, as a 2..30 magnitude. */
const magnitudes = (seed: bigint, count: number): bigint[] => {
  const cursor = { state: seed }
  return Array.from({ length: count }, () => 2n + ((draw(cursor) % 10_000n) * 29n) / 10_000n)
}

describe('casting', () => {
  test('a cast pays, records and resolves in Move mutation order, and every illegal cast changes nothing', () => {
    const fight = started(fixture())
    const target_cell = fight.state().contract.fighters[1]!.cell
    const result = cast(fight, 'slash', target_cell)
    expect(result.events.map(({ type }) => type)).toEqual(['ap_mp_change', 'spell_cast', 'damage_number'])
    expect(result.events[1]!.payload).toEqual({
      caster: 0n,
      spell: 'slash',
      cast_level: 1n,
      target_cell,
      slot: 0n,
      ap_cost: 2n,
      critical: false,
      weapon: false,
    })
    expect(result.events[2]).toMatchObject({ type: 'damage_number', payload: { target: 1n, amount: 40n } })

    const codes = (
      overrides: Partial<SpellLevel>,
      target = 105n,
      prepare?: (checkpoint: HydratedFightCheckpoint) => void
    ) => {
      const checkpoint = open_fixture()
      prepare?.(checkpoint)
      const game = in_turn(with_spells(checkpoint, { probe: spell_level([effect_row()], overrides) }))
      const before = game.state()
      const first = cast(game, 'probe', target)
      if (first.error) expect(game.state()).toEqual(before)
      return [first.error?.code ?? null, cast(game, 'probe', target).error?.code ?? null]
    }
    const invisible = (checkpoint: HydratedFightCheckpoint) => {
      checkpoint.contract.fighters[1]!.effects = [active(EFFECT_KINDS.invis, CHANNELS.any, 0n)]
    }
    expect(codes({}, 100n)).toEqual(['out_of_range', 'out_of_range'])
    expect(codes({ range_max: 4n })).toEqual(['out_of_range', 'out_of_range'])
    expect(codes({}, 380n)).toEqual(['bad_target_cell', 'bad_target_cell'])
    expect(codes({ line_launch: true }, 126n)).toEqual(['not_in_line', 'not_in_line'])
    const wall = (checkpoint: HydratedFightCheckpoint) => {
      checkpoint.contract.board.obstacles = [102n]
    }
    expect(codes({ line_of_sight: true }, 105n, wall)).toEqual(['no_line_of_sight', 'no_line_of_sight'])
    expect(codes({ ap_cost: 7n })).toEqual(['no_ap', 'no_ap'])
    expect(codes({ ap_cost: 4n })).toEqual([null, 'no_ap'])
    expect(codes({ casts_per_turn: 1n })).toEqual([null, 'cast_cap'])
    // An invisible occupant still fills the per-target ledger.
    expect(codes({ casts_per_target: 1n }, 105n, invisible)).toEqual([null, 'target_cap'])
    expect(codes({ casts_per_target: 1n }, 104n)).toEqual([null, null])
    expect(codes({ cooldown_turns: 2n })).toEqual([null, 'cooldown'])
    for (const [field, value] of [
      ['classe', 'tomoda'],
      ['unlock_level', 11n],
    ] as const) {
      const checkpoint = open_fixture()
      checkpoint.sources.spells.slash = { ...checkpoint.sources.spells.slash!, [field]: value }
      expect(cast(in_turn(checkpoint), 'slash', 105n).error?.code).toBe('not_your_spell')
    }
    const invested = open_fixture()
    invested.sources.players['0xc1']!.spell_levels.slash = 2n
    expect(cast(in_turn(invested), 'slash', 105n).error?.code).toBe('not_your_spell')
  })

  test('spell inspection, targeting and previews share the cast rules and never change the checkpoint', () => {
    const checkpoint = open_fixture()
    const level = checkpoint.sources.spells.slash!.levels[0]!
    checkpoint.sources.spells.slash!.levels = [
      { ...structuredClone(level), ap_cost: 5n },
      {
        ...structuredClone(level),
        ap_cost: 3n,
        casts_per_turn: 1n,
        effects: [effect_row({ area_shape: 1n, area_size: 1n, value: 20n, value_max: 20n })],
      },
    ]
    expect(spell_level_of(checkpoint, 0n, 'slash')?.ap_cost).toBe(5n)
    checkpoint.sources.players['0xc1']!.spell_levels.slash = 2n
    expect(spell_level_of(checkpoint, 0n, 'slash')?.ap_cost).toBe(3n)
    expect(spell_level_of(checkpoint, 0n, 'missing')).toBeNull()
    expect(spell_level_of(checkpoint, 1n, 'slash')).toBeNull()
    expect(spell_level_of(checkpoint, 99n, 'slash')).toBeNull()

    const fight = in_turn(checkpoint)
    const state = fight.state()
    const before = structuredClone(state)
    const cells = spell_target_cells(state, 0n, 'slash')
    expect(cells.targetable).toContain(105n)
    expect(cells.targetable).toContain(104n)
    expect(spell_area_cells(state, 0n, 'slash', 104n)).toEqual([84n, 103n, 104n, 105n, 124n])
    // The resolver itself previews the cast, empty anchor included: the mob next to it takes the hit.
    const preview = preview_spell_cast(state, 0n, 'slash', 104n)
    expect(preview).toEqual({
      error: null,
      critical: false,
      targets: [expect.objectContaining({ fighter: 1n, hp_before: 100n, hp_after: 60n, cell_after: 105n })],
    })
    expect(state).toEqual(before)
    const casted = cast(fight, 'slash', 104n)
    expect(casted.state.contract.fighters[0]!.ap).toBe(6n - 3n)
    expect(spell_target_cells(casted.state, 0n, 'slash')).toMatchObject({ targetable: [] })
    expect(preview_spell_cast(casted.state, 0n, 'slash', 105n).error?.code).toBe('cast_cap')
    expect(spell_target_cells(casted.state, 1n, 'slash')).toEqual({ range: [], targetable: [] })

    // A bare-handed strike is assembled from the same weapon rules.
    const unarmed = in_turn(open_fixture()).state()
    unarmed.contract.fighters[1]!.cell = 101n
    expect(weapon_target_cells(unarmed, 0n).targetable).toContain(101n)
    expect(weapon_area_cells(unarmed, 0n, 101n)).toEqual([101n])
    expect(preview_weapon_strike(unarmed, 0n, 101n).targets).toEqual([
      expect.objectContaining({ fighter: 1n, hp_before: 100n, hp_after: 92n }),
    ])
  })

  test('the castable projection keeps range, line of sight, invisibility and range theft exact', () => {
    const checkpoint = in_turn().state()
    checkpoint.contract.fighters[0]!.ap = 0n
    expect(spell_target_cells(checkpoint, 0n, 'slash').range.length).toBeGreaterThan(0)
    expect(spell_target_cells(checkpoint, 0n, 'slash').targetable).toEqual([])
    checkpoint.contract.fighters[0]!.ap = 6n
    checkpoint.sources.spells.slash!.levels[0]!.line_of_sight = true
    checkpoint.contract.board.obstacles = [102n]
    expect(spell_target_cells(checkpoint, 0n, 'slash').range).toContain(105n)
    expect(spell_target_cells(checkpoint, 0n, 'slash').targetable).not.toContain(105n)
    checkpoint.contract.board.obstacles = []

    // A teammate blocks sight until it turns invisible.
    checkpoint.contract.fighters.push({ ...structuredClone(checkpoint.contract.fighters[1]!), team: 0n, cell: 103n })
    expect(spell_target_cells(checkpoint, 0n, 'slash').targetable).not.toContain(105n)
    checkpoint.contract.fighters[2]!.effects = [active(EFFECT_KINDS.invis, CHANNELS.any, 0n)]
    expect(spell_target_cells(checkpoint, 0n, 'slash').targetable).toContain(105n)

    // Range theft lowers a modifiable spell below its authored maximum.
    Object.assign(checkpoint.sources.spells.slash!.levels[0]!, { range_max: 3n, modifiable_range: true })
    checkpoint.contract.fighters[0]!.effects = [active(EFFECT_KINDS.steal, CHANNELS.range, 1n)]
    const { range } = spell_target_cells(checkpoint, 0n, 'slash')
    expect([range.includes(102n), range.includes(103n)]).toEqual([true, false])
  })
})

describe('entropy and effects', () => {
  test('each rolled row draws once per target in Move order; fixed rows and failed chances draw no magnitude', () => {
    const checkpoint = open_fixture()
    checkpoint.contract.fighters.push({ ...structuredClone(checkpoint.contract.fighters[1]!), cell: 110n })
    const kinds = [
      EFFECT_KINDS.add,
      EFFECT_KINDS.remove,
      EFFECT_KINDS.steal,
      EFFECT_KINDS.reduce,
      EFFECT_KINDS.reflect,
      EFFECT_KINDS.chatiment,
    ]
    const spelled = with_spells(checkpoint, {
      rolls: spell_level([
        ...kinds.map((kind) => ranged(kind, CHANNELS.raw_damage)),
        ranged(EFFECT_KINDS.add, CHANNELS.raw_damage, { value: 4n, value_max: 4n }),
        ranged(EFFECT_KINDS.return, 0n),
        ranged(EFFECT_KINDS.invis, 0n),
      ]),
      chances: spell_level([
        ranged(EFFECT_KINDS.add, CHANNELS.raw_damage, { chance_bp: 0n }),
        ranged(EFFECT_KINDS.add, CHANNELS.strength),
        effect_row({ value: 2n, value_max: 30n, target_filter: 1n }),
      ]),
      everyone: spell_level([
        ranged(EFFECT_KINDS.add, CHANNELS.raw_damage, { area_shape: AREA_SHAPES.allmap, target_filter: 0n }),
      ]),
    })
    const fight = in_turn(spelled)

    // The failed chance spends its own draw; the stat buff and the damage take the next two.
    const [, buff, damage] = magnitudes(effect_seed(7n, 0n), 3)
    expect(cast(fight, 'chances', 105n).error).toBeNull()
    const mob = fight.state().contract.fighters[1]!
    expect(mob.effects.map(({ value }) => value)).toEqual([buff])
    expect(mob.hp).toBe(100n - 2n * damage!)

    const rolled = magnitudes(effect_seed(7n, 1n), 6)
    expect(cast(fight, 'rolls', 110n).error).toBeNull()
    expect(fight.state().contract.fighters[2]!.effects.map(({ value }) => value)).toEqual([...rolled, 4n, 1n, 2n])
    expect(fight.state().contract.fighters[0]!.effects.map(({ value }) => value)).toEqual([rolled[2]])

    // An area row draws once per target, in zone-rank order (cell order across the whole map).
    const area = magnitudes(effect_seed(7n, 2n), 3)
    expect(cast(fight, 'everyone', 0n).error).toBeNull()
    expect(fight.state().contract.fighters.map(({ effects }) => effects.at(-1)!.value)).toEqual(area)
  })

  test('the next-turn projection draws one stable crit per spell and rolls only what the target cannot change', () => {
    const checkpoint = open_fixture()
    checkpoint.contract.turn_seed = 5n
    const level = checkpoint.sources.spells.slash!.levels[0]!
    level.crit_1_in = 3n
    level.crit_effects = structuredClone(level.effects)
    checkpoint.sources.spells.stab = structuredClone(checkpoint.sources.spells.slash!)
    expect(['slash', 'stab'].map((name) => project_spell_turn(checkpoint, 0n, name)?.critical)).toEqual([true, false])
    checkpoint.contract.turn_slot = 9n
    expect(['slash', 'stab'].map((name) => project_spell_turn(checkpoint, 0n, name)?.critical)).toEqual([true, false])
    level.crit_effects = []
    expect(project_spell_turn(checkpoint, 0n, 'slash')?.critical).toBeFalse()
    checkpoint.contract.fighters[0]!.effects = [active(EFFECT_KINDS.add, CHANNELS.critical, 9n, 3n)]
    expect(project_spell_turn(checkpoint, 0n, 'slash')?.crit_1_in).toBe(2n)
    expect(project_spell_turn(checkpoint, 0n, 'missing')).toBeNull()

    // A certain crit takes only its branch: the rolled damage shows with strength 100, life steal and the rest raw.
    const base = effect_row({ value: 1n, value_max: 2n })
    Object.assign(level, {
      crit_1_in: 1n,
      effects: [base],
      crit_effects: [
        { ...base, value: 30n, value_max: 50n },
        { ...base, value: 7n, value_max: 7n },
        { ...base, kind: EFFECT_KINDS.steal, stat: CHANNELS.hp, value: 10n, value_max: 10n },
        { ...base, kind: EFFECT_KINDS.pct_life, value: 10n, value_max: 10n },
        { ...base, kind: EFFECT_KINDS.caster_damage, value: 10n, value_max: 10n },
      ],
    })
    checkpoint.contract.fighters[0]!.effects = []
    const before = structuredClone(checkpoint)
    const projected = project_spell_turn(checkpoint, 0n, 'slash')!
    expect(project_spell_turn(checkpoint, 0n, 'slash')).toEqual(projected)
    expect(checkpoint).toEqual(before)
    const [rolled] = projected.effects
    expect(rolled!.value).toBe(rolled!.value_max)
    expect(rolled!.value >= 60n && rolled!.value <= 100n).toBeTrue()
    expect(projected.effects.slice(1).map(({ value }) => value)).toEqual([14n, 20n, 10n, 10n])
    expect(projected.effects.map(({ critical_only }) => critical_only)).toEqual([false, true, true, true, true])

    // After an AP contest the target decides the later draws, so the card keeps the authored range.
    Object.assign(level, {
      crit_1_in: 0n,
      crit_effects: [],
      effects: [
        ranged(EFFECT_KINDS.remove, CHANNELS.ap, { value: 2n, value_max: 2n, turns: 1n }),
        effect_row({ value: 10n, value_max: 20n }),
      ],
    })
    expect(project_spell_turn(checkpoint, 0n, 'slash')!.effects[1]).toMatchObject({ value: 20n, value_max: 40n })
    level.effects = [
      ranged(EFFECT_KINDS.add, CHANNELS.raw_damage, { area_shape: AREA_SHAPES.allmap }),
      effect_row({ value: 10n, value_max: 20n }),
    ]
    expect(
      project_spell_turn(checkpoint, 0n, 'slash')!.effects.map(({ value, value_max }) => [value, value_max])
    ).toEqual([
      [2n, 30n],
      [20n, 40n],
    ])

    // Gear, folded stats and buffs all reach the card; a trap row shows its area untouched.
    const player = checkpoint.sources.players['0xc1']!
    player.folded_stats.strength = 32_818n
    player.folded_stats.raw_damage = 32_772n
    checkpoint.contract.fighters[0]!.effects = [
      active(EFFECT_KINDS.add, CHANNELS.strength, 25n),
      active(EFFECT_KINDS.add, CHANNELS.power, 25n),
    ]
    level.effects = [
      effect_row({ kind: EFFECT_KINDS.trap, value: 0n, value_max: 0n, area_shape: 1n, area_size: 2n }),
      effect_row({ value: 7n, value_max: 16n, area_shape: 1n, area_size: 2n }),
      ranged(EFFECT_KINDS.steal, CHANNELS.mp, { value: 2n, value_max: 2n }),
    ]
    expect(project_spell_turn(checkpoint, 0n, 'slash')!.effects).toMatchObject([
      { kind: EFFECT_KINDS.trap, area_size: 2n },
      { value: 25n, value_max: 52n },
      { value: 2n, value_max: 2n },
    ])
    const self_row = { ...level.effects[0]!, target_filter: TARGET_FILTERS.only_caster }
    expect(spell_effect_area_cells(checkpoint, 0n, 104n, self_row)).toEqual([checkpoint.contract.fighters[0]!.cell])

    // A weapon card counts the wielder's stats once.
    Object.assign(player.folded_stats, { strength: 32_768n, raw_damage: 32_768n })
    checkpoint.contract.fighters[0]!.effects = []
    player.weapon = { category: 'sword', damages: [{ element: 'earth', from: 10n, to: 10n }] }
    const with_stats = project_weapon_turn(checkpoint, 0n)!
    player.strength = 0n
    const without_stats = project_weapon_turn(checkpoint, 0n)!
    expect(with_stats.critical).toBe(without_stats.critical)
    expect(with_stats.effects[0]!.value).toBe(without_stats.effects[0]!.value * 2n)
  })

  test('direct damage reveals an invisible caster, a trap does not, and swaps respect sides and sight', () => {
    const checkpoint = open_fixture()
    const trap = effect_row({ kind: EFFECT_KINDS.trap, value: 0n, value_max: 0n, area_shape: 1n, area_size: 1n })
    const swap = effect_row({ kind: EFFECT_KINDS.swap, value: 0n, value_max: 0n, target_filter: 1n })
    const spelled = with_spells(checkpoint, {
      snare: spell_level([trap, effect_row()], { ap_cost: 1n }),
      swap: spell_level([swap], { ap_cost: 1n }),
    })
    checkpoint.contract.fighters[0]!.effects = [active(EFFECT_KINDS.invis, CHANNELS.any, 0n, 3n)]
    const ally = { ...structuredClone(checkpoint.contract.fighters[0]!), cell: 101n, effects: [] }
    checkpoint.contract.fighters.push(ally)
    checkpoint.sources.spells.slash!.levels[0]!.ap_cost = 1n
    const fight = in_turn(spelled)
    const invisible = () => fight.state().contract.fighters[0]!.effects.some(({ kind }) => kind === EFFECT_KINDS.invis)

    expect(cast(fight, 'snare', 103n)).toMatchObject({
      error: null,
      events: [{}, {}, { type: 'trap_placed', payload: { visibility: 'owner' } }],
    })
    expect(invisible()).toBeTrue()
    expect(cast(fight, 'swap', 101n).state.contract.fighters.map(({ cell }) => cell)).toEqual([100n, 105n, 101n])
    const hidden = structuredClone(fight.state())
    hidden.contract.fighters[1]!.effects = [active(EFFECT_KINDS.invis, CHANNELS.any, 0n)]
    const sneaky = create_fight({ state: hidden, mode: 'local' })
    expect(cast(sneaky, 'swap', 105n).state.contract.fighters.map(({ cell }) => cell)).toEqual([100n, 105n, 101n])
    expect(cast(fight, 'swap', 105n).state.contract.fighters.map(({ cell }) => cell)).toEqual([105n, 100n, 101n])
    const revealed = cast(fight, 'slash', 100n)
    expect(revealed.error).toBeNull()
    expect(invisible()).toBeFalse()
    expect(revealed.events).toContainEqual({
      type: 'invisibility_changed',
      payload: { fighter: 0n, invisible: false, reason: 'direct_damage_cast' },
    })
  })

  test('life steal drinks half of what landed; percent-life rolls its band; a caster-only cost spares the ally', () => {
    const checkpoint = open_fixture()
    checkpoint.contract.fighters[0]!.hp = 40n
    const percent = effect_row({ kind: EFFECT_KINDS.pct_life, value: 8n, value_max: 11n, target_filter: 1n })
    const steal = ranged(EFFECT_KINDS.steal, CHANNELS.hp, { element: 'earth', value: 15n, value_max: 15n, turns: 0n })
    const spelled = with_spells(checkpoint, { drain: spell_level([steal]), percentage: spell_level([percent]) })
    const drained = cast(in_turn(spelled), 'drain', 105n)
    const damage = drained.events.find(({ type }) => type === 'damage_number')!
    const heal = drained.events.find(({ type }) => type === 'heal_number')!
    expect(damage.payload).toMatchObject({ target: 1n, amount: 30n })
    expect(heal.payload).toMatchObject({ target: 0n, amount: 15n, cause: 'life_steal' })

    const rolled_percent = 8n + ((draw({ state: effect_seed(7n, 0n) }) % 10_000n) * 4n) / 10_000n
    expect(rolled_percent).toBeGreaterThan(8n)
    expect(cast(in_turn(spelled), 'percentage', 105n).events).toContainEqual(
      expect.objectContaining({
        type: 'damage_number',
        payload: expect.objectContaining({ target: 1n, amount: rolled_percent }),
      })
    )

    // The cost lands on the caster, and the ally-only heal finds nobody wounded to heal.
    const cost = effect_row({
      kind: EFFECT_KINDS.caster_damage,
      element: 'water',
      value: 18n,
      value_max: 18n,
      target_filter: 4n,
    })
    const heal_ally = effect_row({
      kind: EFFECT_KINDS.add,
      element: '',
      value: 18n,
      value_max: 18n,
      target_filter: 3n,
      stat: CHANNELS.hp,
    })
    const party = open_fixture()
    party.contract.fighters.push({ ...structuredClone(party.contract.fighters[0]!), cell: 101n })
    party.contract.fighters[0]!.hp = 100n
    const bled = cast(
      in_turn(with_spells(party, { bleeding_word: spell_level([cost, heal_ally]) })),
      'bleeding_word',
      101n
    )
    expect(bled.state.contract.fighters.map(({ hp }) => hp)).toEqual([82n, 100n, 100n])
    expect(bled.events.some(({ type }) => type === 'heal_number')).toBeFalse()
  })

  test('shields scale with their element, stop only matching damage, and points removal follows the target turn', () => {
    const shield = (agility: bigint) => {
      const checkpoint = open_fixture()
      Object.assign(checkpoint.sources.players['0xc1']!, { agility })
      checkpoint.sources.players['0xc1']!.folded_stats.raw_damage = 33_168n
      const level = spell_level([
        ranged(EFFECT_KINDS.reduce, CHANNELS.any, {
          element: 'air',
          value: 12n,
          value_max: 12n,
          target_filter: 4n,
          turns: 1n,
        }),
      ])
      return cast(in_turn(with_spells(checkpoint, { guard: level })), 'guard', 105n).state.contract.fighters[0]!
        .effects[0]!.value
    }
    expect([shield(0n), shield(400n)]).toEqual([12n, 60n])

    const checkpoint = open_fixture()
    checkpoint.contract.fighters[1]!.effects = [
      { ...active(EFFECT_KINDS.reduce, CHANNELS.any, 100n, 1n, 'earth'), source: 1n },
      { ...active(EFFECT_KINDS.reduce, CHANNELS.any, 9n, 1n, 'air'), source: 1n },
      { ...active(EFFECT_KINDS.reduce, CHANNELS.any, 3n, 1n), source: 1n },
    ]
    checkpoint.sources.players['0xc1']!.wisdom = 1_000n
    const spelled = with_spells(checkpoint, {
      gust: spell_level([effect_row({ element: 'air', value: 100n, value_max: 100n })], { ap_cost: 1n }),
      sap: spell_level([ranged(EFFECT_KINDS.remove, CHANNELS.ap, { value: 2n, value_max: 2n, turns: 1n })], {
        ap_cost: 1n,
      }),
      drain: spell_level(
        [ranged(EFFECT_KINDS.fixed_remove, CHANNELS.ap, { value: 100n, value_max: 100n, turns: 3n })],
        {
          ap_cost: 1n,
        }
      ),
    })
    const fight = in_turn(spelled)
    const gust = cast(fight, 'gust', 105n)
    expect(gust.events.find(({ type }) => type === 'damage_reduced')!.payload).toEqual({
      source: 0n,
      target: 1n,
      prevented: 12n,
      remaining: 88n,
      effect_ids: ['initial:effect:1:1', 'initial:effect:1:2'],
    })
    expect(gust.state.contract.fighters[1]!.hp).toBe(12n)
    // The HUD resistances add gear, the element's rows and the all-element rows.
    const worn = structuredClone(gust.state)
    worn.sources.players['0xc1']!.folded_stats.earth_resistance = 32_778n
    worn.contract.fighters[0]!.effects = [active(EFFECT_KINDS.add, CHANNELS.resist, 3n)]
    const mob = worn.contract.fighters[1] as MobFighter
    mob.kind.snapshot.earth_res = 32_788n
    mob.effects = [active(EFFECT_KINDS.remove, CHANNELS.resist, 5n, 2n, 'earth')]
    expect([0n, 1n].map((seat) => fighter_resistances(worn, seat))).toEqual([
      { earth: 13n, fire: 3n, water: 3n, air: 3n },
      { earth: 15n, fire: 0n, water: 0n, air: 0n },
    ])

    // An inactive target contests against its next-turn pool and keeps what it lost for that turn.
    const sap = cast(fight, 'sap', 105n)
    const contested = sap.events.find(({ type }) => type === 'points_contested')!
    expect(contested.payload).toMatchObject({ source: 0n, target: 1n, attempted: 2n, stolen: false })
    const { removed } = contested.payload as { removed: bigint }
    expect(removed).toBeGreaterThan(0n)
    expect(sap.state.contract.fighters[1]!.effects.at(-1)).toMatchObject({
      kind: EFFECT_KINDS.remove,
      value: removed,
      turns_left: 1n,
    })
    expect(sap.state.contract.fighters[1]!.ap).toBe(0n)
    // A fixed removal is never contested and lasts its turns.
    const drain = cast(fight, 'drain', 105n)
    expect(drain.events).toContainEqual(
      expect.objectContaining({
        type: 'points_contested',
        payload: expect.objectContaining({ attempted: 100n, removed: 100n }),
      })
    )
    expect(drain.state.contract.fighters[1]!.effects.at(-1)).toMatchObject({
      kind: EFFECT_KINDS.fixed_remove,
      turns_left: 3n,
    })
  })

  test('a zone needs a free center: traps also need an empty cell, and one cast places one zone', () => {
    const placing = (kind: bigint, count = 1) =>
      spell_level(
        Array.from({ length: count }, () =>
          effect_row({
            kind,
            element: '',
            value: 0n,
            value_max: 0n,
            area_shape: 1n,
            area_size: 2n,
            turns: kind === EFFECT_KINDS.glyph ? 3n : 0n,
          })
        ),
        { range_min: 0n, free_cell: true }
      )
    const outcome = (kind: bigint, target: bigint, zones: number[] = [], count = 1) => {
      const checkpoint = with_spells(open_fixture(), { place: placing(kind, count) })
      checkpoint.contract.zones = zones.map((anchor) => ({
        owner_fighter: 1n,
        trap: anchor < 0,
        shape: 1n,
        size: 2n,
        anchor: BigInt(Math.abs(anchor)),
        turns_left: anchor < 0 ? 0n : 3n,
        effects: [],
      }))
      const fight = in_turn(checkpoint)
      const before = fight.state()
      const result = cast(fight, 'place', target)
      if (result.error) expect(result).toMatchObject({ events: [], state: before })
      return result.error?.code ?? result.state.contract.zones.map(({ anchor }) => anchor)
    }
    for (const kind of [EFFECT_KINDS.trap, EFFECT_KINDS.glyph]) {
      expect(outcome(kind, 102n, [-102])).toBe('bad_target_cell')
      expect(outcome(kind, 102n, [102])).toBe('bad_target_cell')
      expect(outcome(kind, 103n, [102])).toEqual([102n, 103n])
      expect(outcome(kind, 102n, [], 2)).toBe('bad_target_cell')
    }
    expect(outcome(EFFECT_KINDS.trap, 105n)).toBe('bad_target_cell')
    expect(outcome(EFFECT_KINDS.glyph, 105n)).toEqual([105n])
  })

  test('zone ranks enumerate exactly the cells of every shape, in traversal order', () => {
    const cases = [
      [encode_cell(10n, 9n), encode_cell(10n, 9n)],
      [encode_cell(15n, 9n), encode_cell(10n, 9n)],
      [encode_cell(5n, 9n), encode_cell(10n, 9n)],
      [encode_cell(10n, 14n), encode_cell(10n, 9n)],
      [encode_cell(10n, 4n), encode_cell(10n, 9n)],
      [encode_cell(0n, 0n), encode_cell(1n, 1n)],
      [encode_cell(19n, 18n), encode_cell(18n, 17n)],
    ] as const
    for (let shape = 0n; shape < 10n; shape += 1n)
      for (const size of [0n, 1n, 3n, 10n])
        for (const [anchor, caster] of cases) {
          const ranked = Array.from({ length: 380 }, (_, index) => ({
            cell: BigInt(index),
            rank: zone_rank(shape, size, anchor, caster, BigInt(index)),
          })).filter((entry): entry is { cell: bigint; rank: bigint } => entry.rank !== null)
          expect(ranked.toSorted((left, right) => Number(left.rank - right.rank)).map(({ cell }) => cell)).toEqual(
            zone_cells(shape, size, anchor, caster)
          )
        }
  })
})
