// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Turn boundaries: lasting rows, zones, walking, displacement and mob turns, all driven through end_turn and move_to.

import { describe, expect, test } from 'bun:test'

import mobs from '../../../seed/content/mobs.json'
import spells from '../../../seed/content/spells.json'
import { encode_cell, mask_from_cells } from '../src/combat_grid.ts'
import {
  CONTRACT_CONSTANTS,
  create_character_source,
  create_fight,
  movement_points_of,
  sheet_of,
  type ActiveEffect,
  type BoardZone,
  type FightEvent,
  type HydratedFightCheckpoint,
  type MobFighter,
  type PlayerFighter,
  type SpellLevel,
} from '../src/index.ts'
import { CHANNELS, EFFECT_KINDS } from '../src/move_contract.gen.ts'
import { normalize_sources } from '../src/normalize.ts'

import { active, effect_row, fixture, open_fixture, spell_level, started, with_spells } from './helpers.ts'

type LocalFight = ReturnType<typeof started>

/** Ends the active fighter's turn at the earliest legal time. */
const pass = (fight: LocalFight) => {
  const { contract } = fight.state()
  const fighter = contract.queue[Number(contract.turn_ptr)]!
  const result = fight.apply({
    type: 'end_turn',
    fighter,
    observed_ms: contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms,
  })
  expect(result.error).toBeNull()
  return result
}

const of_type = (events: readonly FightEvent[], type: FightEvent['type']) =>
  events.filter((event) => event.type === type)

/** Seat 0 is a rival senshi who plays first; seat 1 is the senshi under test. No mob: turns alternate. */
const duel = (prepare: (checkpoint: HydratedFightCheckpoint) => void) => {
  const checkpoint = fixture()
  const hero = checkpoint.contract.fighters[0] as PlayerFighter
  const rival = { ...structuredClone(hero), kind: { ...hero.kind, character: '0xc2', owner: '0xa2' } }
  Object.assign(hero, { team: 1n, cell: checkpoint.contract.board.start_cells_b[0]! })
  checkpoint.contract.fighters = [rival, hero]
  checkpoint.sources.players['0xc2'] = checkpoint.sources.players['0xc1']!
  prepare(checkpoint)
  return started(checkpoint)
}

const zone = (owner_fighter: bigint, anchor: bigint, overrides: Partial<BoardZone> = {}): BoardZone => ({
  owner_fighter,
  trap: true,
  shape: 0n,
  size: 0n,
  anchor,
  turns_left: 0n,
  effects: [effect_row({ value: 5n, value_max: 5n })],
  ...overrides,
})

describe('lasting rows and zones', () => {
  test('lasting rows count only their holder turns, and a final-turn row keeps working until the next turn', () => {
    const rows: ActiveEffect[] = [
      active(EFFECT_KINDS.remove, CHANNELS.hp, 7n, 2n, 'earth'),
      active(EFFECT_KINDS.add, CHANNELS.hp, 3n),
      active(EFFECT_KINDS.add, CHANNELS.strength, 11n),
      active(EFFECT_KINDS.remove, CHANNELS.strength, 4n),
      active(EFFECT_KINDS.reduce, CHANNELS.any, 5n),
      active(EFFECT_KINDS.add, CHANNELS.ap, 2n, 1n),
      active(EFFECT_KINDS.remove, CHANNELS.mp, 1n, 1n),
      active(EFFECT_KINDS.invis, CHANNELS.any, 0n, 1n),
      active(EFFECT_KINDS.invis, CHANNELS.any, 0n, 2n),
    ]
    const fight = duel((checkpoint) => {
      Object.assign(checkpoint.contract.fighters[1]!, { hp: 80n, effects: rows })
    })
    const hero = () => fight.state().contract.fighters[1]!
    const turns = () => hero().effects.map(({ turns_left }) => turns_left)
    const strike = () => fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell: hero().cell })
    const events: FightEvent[] = []
    const { strength } = sheet_of(fight.state(), 1n)
    expect(strength).toBe(107n)

    // The rival's turn consumes nothing of the hero's; the shield stops five of the forty.
    expect(turns()).toEqual([2n, 2n, 2n, 2n, 2n, 1n, 1n, 1n, 2n])
    events.push(...strike().events)
    expect(hero().hp).toBe(45n)
    events.push(...pass(fight).events)
    expect(hero()).toMatchObject({ hp: 46n, ap: 8n, mp: 2n })
    expect(turns()).toEqual([1n, 1n, 2n, 2n, 2n, 1n, 1n, 1n, 2n])
    events.push(...pass(fight).events)
    expect(turns()).toEqual([1n, 1n, 1n, 1n, 1n, 0n, 0n, 0n, 1n])
    expect(movement_points_of(fight.state(), 1n)).toBe(3n)
    const second = pass(fight)
    events.push(...second.events)
    expect(of_type(second.events, 'effect_expired').map(({ payload }) => payload)).toEqual(
      [5, 6, 7].map((index) => expect.objectContaining({ target: 1n, effect_id: `initial:effect:1:${index}` }))
    )
    expect(hero()).toMatchObject({ hp: 47n, ap: 6n, mp: 3n })
    expect(turns()).toEqual([0n, 0n, 1n, 1n, 1n, 1n])
    events.push(...pass(fight).events)
    // A row on its last turn still shields and still counts between turns.
    expect(sheet_of(fight.state(), 1n).strength).toBe(strength)
    events.push(...strike().events)
    expect(hero().hp).toBe(12n)
    const third = pass(fight)
    events.push(...third.events)
    expect(hero().effects).toEqual([])
    expect(sheet_of(fight.state(), 1n).strength).toBe(100n)
    expect(
      of_type(third.events, 'effect_expired').map(({ payload }) => (payload as { effect_id: string }).effect_id)
    ).toEqual([0, 1, 2, 3, 4, 8].map((index) => `initial:effect:1:${index}`))
    expect(of_type(events, 'invisibility_changed')).toEqual([
      { type: 'invisibility_changed', payload: { fighter: 1n, invisible: false, reason: 'expired' } },
    ])
    expect(
      [of_type(events, 'damage_number'), of_type(events, 'heal_number'), of_type(events, 'damage_reduced')].map(
        (list) => list.length
      )
    ).toEqual([4, 2, 4])
  })

  test('a glyph fires at its victim turn start, counts down on its owner turns, and zones die with their owner', () => {
    const fight = duel((checkpoint) => {
      const [rival, hero] = checkpoint.contract.fighters
      const free = checkpoint.contract.board.start_cells_a.filter((cell) => cell !== rival!.cell)
      rival!.hp = 1n
      checkpoint.contract.zones = [
        zone(0n, hero!.cell, { trap: false, turns_left: 2n, effects: [effect_row({ value: 4n, value_max: 4n })] }),
        zone(1n, free[0]!, { trap: false, turns_left: 1n, effects: [] }),
        zone(0n, free[1]!),
      ]
    })
    const events = [...pass(fight).events, ...pass(fight).events, ...pass(fight).events]
    expect(of_type(events, 'glyph_triggered')).toEqual([
      {
        type: 'glyph_triggered',
        payload: expect.objectContaining({ zone_id: 'initial:zone:0', owner: 0n, fighter: 1n }),
      },
    ])
    expect(fight.state().contract.fighters[1]!.hp).toBe(92n)
    const rival_cell = fight.state().contract.fighters[0]!.cell
    const killed = fight.apply({ type: 'cast_spell', fighter: 1n, spell: 'slash', target_cell: rival_cell })
    expect(of_type([...events, ...killed.events], 'zone_removed').map(({ payload }) => payload)).toEqual([
      { zone_id: 'initial:zone:1', kind: 'glyph', reason: 'expired' },
      { zone_id: 'initial:zone:0', kind: 'glyph', reason: 'expired' },
      { zone_id: 'initial:zone:2', kind: 'trap', reason: 'owner_died' },
    ])
    expect(killed.state.contract).toMatchObject({ zones: [], ended: true, winner: 1n })
  })

  test('a glyph refreshes its bonus each owner turn without ever stacking it', () => {
    const checkpoint = fixture()
    const bonus = effect_row({
      kind: EFFECT_KINDS.add,
      element: '',
      value: 5n,
      value_max: 5n,
      turns: 1n,
      stat: CHANNELS.raw_damage,
    })
    checkpoint.contract.zones = [
      zone(0n, checkpoint.contract.fighters[0]!.cell, { trap: false, turns_left: 3n, effects: [bonus] }),
    ]
    const fight = started(checkpoint)
    for (let turn = 0; turn < 2; turn += 1) {
      expect(fight.state().contract.fighters[0]!.effects).toEqual([
        expect.objectContaining({ value: 5n, turns_left: 1n }),
      ])
      expect(sheet_of(fight.state(), 0n).raw_damage).toBe(5n)
      pass(fight)
    }
  })

  test('periodic damage meets the current shields of the authored Sylvan Power combo, and resumes after them', () => {
    const names = ['Poisoned Wind', 'Earthquake', 'Sylvan Power']
    const source = create_character_source({
      classe: 'mori',
      level: 200n,
      vitality: 200n,
      strength: 100n,
      intelligence: 200n,
      spell_levels: Object.fromEntries(names.map((name) => [name, 6n])),
      folded_stats: {
        action: CONTRACT_CONSTANTS.item_stat_shift + 1n,
        raw_damage: CONTRACT_CONSTANTS.item_stat_shift + 10n,
      },
    })
    const board = {
      ...fixture().contract.board,
      shape_mask: mask_from_cells(Array.from({ length: 380 }, (_, index) => BigInt(index))),
      obstacles: [],
      holes: [],
    }
    const fight = create_fight({
      mode: 'local',
      seed: 91n,
      setup: {
        board,
        players: [
          { character: 'caster', owner: 'a', team: 0n, cell: 100n, hp: 1000n, ready: true, source },
          { character: 'enemy', owner: 'b', team: 1n, cell: 200n, hp: 1000n, ready: true, source },
        ],
        mobs: [],
        spells: normalize_sources({
          spells: Object.fromEntries(
            spells.filter(({ name }) => names.includes(name)).map((spell) => [spell.name, spell])
          ),
        }).spells,
      },
    })
    expect(fight.apply({ type: 'start', observed_ms: 1n }).error).toBeNull()
    for (const spell of names)
      expect(fight.apply({ type: 'cast_spell', fighter: 0n, spell, target_cell: 100n }).error).toBeNull()
    const poison = fight
      .state()
      .contract.fighters[0]!.effects.filter(({ kind, stat }) => kind === EFFECT_KINDS.remove && stat === CHANNELS.hp)
      .reduce((total, { value }) => total + value, 0n)
    for (let round = 0n; round < 4n; round += 1n) {
      pass(fight)
      pass(fight)
      expect(fight.state().contract.fighters[0]!.hp).toBe(1000n + 16n * (round + 1n) - (round === 3n ? poison : 0n))
      expect(fight.state().contract.fighters[1]!.hp).toBeLessThan(1000n)
    }
  })
})

describe('walking and displacement', () => {
  /** The walker (seat 0, escaping every tackle) at `start` and the mob at `mob` on an open board. */
  const walker = (start: bigint, mob: bigint, zones: BoardZone[] = []) => {
    const checkpoint = open_fixture()
    checkpoint.sources.players['0xc1']!.agility = 1_000n
    checkpoint.contract.fighters[0]!.cell = start
    checkpoint.contract.fighters[1]!.cell = mob
    checkpoint.contract.zones = zones
    return started(checkpoint)
  }
  const walk = (fight: LocalFight, path: bigint[]) => fight.apply({ type: 'move_to', fighter: 0n, path })
  const visible = (events: readonly FightEvent[]) =>
    events
      .filter(({ type }) => ['fighter_moved', 'trap_triggered', 'zone_removed', 'damage_number'].includes(type))
      .map(({ type }) => type)

  test('a walk follows the declared path, pays tackles, and stops at a body a trap pulled onto it', () => {
    const steered = walk(walker(100n, 110n), [120n, 121n])
    expect(of_type(steered.events, 'fighter_moved').map(({ payload }) => (payload as { to: bigint }).to)).toEqual([
      120n,
      121n,
    ])
    const locked = walk(
      walker(105n, 86n),
      [106n, 107n].map((cell) => cell)
    )
    expect(of_type(locked.events, 'tackle_resolved').map(({ payload }) => (payload as { cell: bigint }).cell)).toEqual([
      106n,
    ])

    const pull = effect_row({ kind: EFFECT_KINDS.pull, element: '', value: 1n, value_max: 1n })
    const pulled = walk(walker(100n, 103n, [zone(1n, 101n, { shape: 1n, size: 2n, effects: [pull] })]), [101n, 102n])
    expect(pulled.error).toBeNull()
    expect(pulled.state.contract.fighters.map(({ cell }) => cell)).toEqual([101n, 102n])

    const two = walk(walker(100n, 110n, [zone(1n, 101n), zone(1n, 102n)]), [101n, 102n])
    expect(visible(two.events)).toEqual(
      [...Array(2)].flatMap(() => ['fighter_moved', 'trap_triggered', 'zone_removed', 'damage_number'])
    )
    expect(two.state.contract.zones).toEqual([])
  })

  test('a trap fires on entering any of its cells, never on leaving, and hits every target in its area', () => {
    const edge = walk(walker(101n, 110n, [zone(1n, 102n, { shape: 1n, size: 1n })]), [100n])
    expect(edge.events.some(({ type }) => type === 'trap_triggered')).toBeFalse()
    expect(edge.state.contract.zones).toHaveLength(1)
    const inside = walk(walker(101n, 110n, [zone(1n, 100n, { shape: 1n, size: 2n })]), [102n])
    expect(of_type(inside.events, 'trap_triggered')).toHaveLength(1)

    // The owner springing its own trap still hits the enemy inside the payload area, with its current bonuses.
    const own = zone(0n, 100n, {
      shape: 1n,
      size: 1n,
      effects: [effect_row({ value: 4n, value_max: 4n, target_filter: 1n })],
    })
    const sprung = walk(walker(120n, 101n, [own]), [100n])
    expect(of_type(sprung.events, 'damage_number').map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ target: 1n, amount: 8n }),
    ])
    const boosted = walker(120n, 101n, [own])
    const buffed = boosted.state()
    buffed.contract.fighters[0]!.effects = [active(EFFECT_KINDS.add, CHANNELS.raw_damage, 17n)]
    boosted.replace(buffed)
    expect(of_type(walk(boosted, [100n]).events, 'damage_number')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ amount: 25n }) }),
    ])

    // Number rows land before displacement, across overlapping traps.
    const push = effect_row({ kind: EFFECT_KINDS.push, element: '', value: 1n, value_max: 1n, target_filter: 1n })
    const stacked = walk(
      walker(102n, 150n, [zone(1n, 100n, { shape: 1n, size: 1n, effects: [push] }), zone(1n, 101n)]),
      [101n]
    )
    expect(visible(stacked.events)).toEqual([
      'fighter_moved',
      'trap_triggered',
      'zone_removed',
      'damage_number',
      'trap_triggered',
      'zone_removed',
      'fighter_moved',
    ])
    expect(stacked.state.contract.fighters[0]!.cell).toBe(102n)
    // A push centred on its own target is a soft stop: no move, no collision.
    const centred = walk(walker(100n, 110n, [zone(1n, 101n, { effects: [push] })]), [101n])
    expect(centred.state.contract.fighters[0]).toMatchObject({ cell: 101n, hp: 100n })
    expect(centred.events.some(({ type }) => type === 'push_collided')).toBeFalse()
  })

  test('a level-two wall slam deals the Retro floor of 24', () => {
    const checkpoint = open_fixture()
    const caster = checkpoint.contract.fighters[0] as PlayerFighter
    caster.kind.level = 2n
    checkpoint.sources.players['0xc1']!.level = 2n
    checkpoint.contract.closed = mask_from_cells([102n])
    Object.assign(caster, { cell: 100n })
    checkpoint.contract.fighters[1]!.cell = 101n
    const spelled = with_spells(checkpoint, {
      shove: spell_level([
        effect_row({ kind: EFFECT_KINDS.push, element: '', value: 3n, value_max: 3n, target_filter: 1n }),
      ]),
    })
    const slam = started(spelled).apply({ type: 'cast_spell', fighter: 0n, spell: 'shove', target_cell: 101n })
    expect(slam.state.contract.fighters[1]).toMatchObject({ cell: 101n, hp: 76n })
    expect(slam.events).toContainEqual(
      expect.objectContaining({
        type: 'push_collided',
        payload: expect.objectContaining({ blocked_cells: 3n, damage: 24n }),
      })
    )
  })
})

describe('mob turns', () => {
  /** The player at `player`, the mob at `mob`, then the player ends its first turn and the mob plays. */
  const mob_plays = (
    player: bigint,
    mob: bigint,
    prepare?: (checkpoint: HydratedFightCheckpoint, mob: MobFighter) => void
  ) => {
    const checkpoint = open_fixture()
    checkpoint.contract.fighters[0]!.cell = player
    checkpoint.contract.fighters[1]!.cell = mob
    prepare?.(checkpoint, checkpoint.contract.fighters[1] as MobFighter)
    return pass(started(checkpoint))
  }
  const kit = (name: string, level: SpellLevel) => [{ name, ordinal: 1n, level }]
  const frog_wall = Array.from({ length: 6 }, (_, index) => encode_cell(4n, BigInt(3 + index)))

  test('a mob walks its budget around a wall, holds only when its target is sealed, and searches when blind', () => {
    const wall = (cells: bigint[]) => (checkpoint: HydratedFightCheckpoint) => {
      checkpoint.contract.closed = mask_from_cells(cells)
    }
    expect(mob_plays(encode_cell(5n, 5n), encode_cell(3n, 5n), wall(frog_wall)).state.contract.fighters[1]!.cell).toBe(
      encode_cell(3n, 2n)
    )
    const sealed = wall([...frog_wall, encode_cell(5n, 4n), encode_cell(5n, 6n), encode_cell(6n, 5n)])
    const held = mob_plays(encode_cell(5n, 5n), encode_cell(3n, 5n), (checkpoint, mob) => {
      sealed(checkpoint)
      mob.kind.snapshot.mp = 6n
    })
    expect(held.state.contract.fighters[1]!.cell).toBe(encode_cell(3n, 5n))

    const fixture_starts = fixture().contract.board.start_cells_a
    const blind = mob_plays(fixture_starts[1]!, fixture_starts[0]!, (checkpoint) => {
      checkpoint.contract.fighters[0]!.effects = [active(EFFECT_KINDS.invis, CHANNELS.any, 0n)]
    })
    expect(blind.state.contract.fighters[1]!.cell).not.toBe(fixture_starts[0])
    expect(blind.events.some(({ type }) => type === 'spell_cast')).toBeFalse()
  })

  test('a ranged mob casts from the nearest legal cell its points reach, authored protector kits included', () => {
    for (const line_launch of [true, false]) {
      const result = mob_plays(encode_cell(7n, 6n), encode_cell(4n, 5n), (_, mob) => {
        Object.assign(mob.kind.snapshot, { ap: 2n, mp: 1n })
        mob.kind.snapshot.kit[0]!.level = {
          ...mob.kind.snapshot.kit[0]!.level,
          range_min: 3n,
          range_max: 5n,
          line_launch,
        }
      })
      expect(result.state.contract.fighters[0]!.hp).toBeLessThan(100n)
      expect(result.state.contract.fighters[1]).toMatchObject({
        cell: line_launch ? encode_cell(4n, 6n) : encode_cell(5n, 5n),
        ap: 0n,
      })
    }
    for (const mob_type of ['protector_amber', 'protector_jade', 'protector_quartz']) {
      const authored = mobs.find((candidate) => candidate.mob_type === mob_type)!
      const result = mob_plays(encode_cell(7n, 6n), encode_cell(4n, 5n), (_, mob) => {
        Object.assign(mob.kind.snapshot, { ap: BigInt(authored.ap), mp: BigInt(authored.mp) })
        mob.cooldowns = [{ spell: 'Prismatic Guard', left: 3n }]
        mob.kind.snapshot.kit = authored.spells.map(({ name, levels }) => ({
          name,
          ordinal: 1n,
          level: normalize_sources({ spells: { [name]: { classe: '', levels: [levels[0]] } } }).spells[name]!
            .levels[0]!,
        }))
      })
      const cast_at = result.events.findIndex(
        (event) => event.type === 'spell_cast' && event.payload.spell === 'Shard Volley'
      )
      expect(cast_at, mob_type).toBeGreaterThan(0)
      const moved = result.events.slice(0, cast_at).find((event) => event.type === 'fighter_moved')
      expect(moved?.payload).toMatchObject({ from: encode_cell(4n, 5n), to: encode_cell(4n, 6n) })
      expect(result.state.contract.fighters[0]!.hp).toBeLessThan(100n)
    }
  })

  test('a mob spends its points on repeated casts within its authored caps and aims ally buffs at allies', () => {
    const repeat = (casts_per_turn: bigint) =>
      mob_plays(encode_cell(5n, 5n), encode_cell(5n, 6n), (_, mob) => {
        Object.assign(mob.kind.snapshot, { ap: 8n, mp: 0n })
        mob.kind.snapshot.kit = kit(
          'Repeat Bite',
          spell_level([effect_row({ target_filter: 1n })], {
            ap_cost: 4n,
            range_max: 1n,
            line_of_sight: true,
            casts_per_turn,
          })
        )
      })
    expect([0n, 1n].map((cap) => repeat(cap).state.contract.fighters.map(({ hp, ap }) => [hp, ap]))).toEqual([
      [
        [80n, 6n],
        [100n, 0n],
      ],
      [
        [90n, 6n],
        [100n, 4n],
      ],
    ])

    const buff = spell_level(
      [
        effect_row({
          kind: EFFECT_KINDS.add,
          element: '',
          value: 4n,
          value_max: 10n,
          target_filter: 3n,
          turns: 2n,
          stat: CHANNELS.raw_damage,
        }),
      ],
      { range_min: 0n, cooldown_turns: 5n }
    )
    const buffed = mob_plays(
      fixture().contract.board.start_cells_a[0]!,
      fixture().contract.board.start_cells_b[0]!,
      (checkpoint, mob) => {
        mob.kind.snapshot.kit = kit('Nifuwoost', buff)
        const ally = structuredClone(mob)
        Object.assign(ally, { cell: fixture().contract.board.start_cells_b[1]! })
        ally.kind.snapshot.kit = []
        checkpoint.contract.fighters.push(ally)
      }
    )
    expect(
      buffed.state.contract.fighters.map(({ effects }) => effects.some(({ stat }) => stat === CHANNELS.raw_damage))
    ).toEqual([false, false, true])

    // A second mob finds the glyph center taken and falls back to its next spell.
    const glyph = spell_level(
      [
        effect_row({
          kind: EFFECT_KINDS.glyph,
          element: '',
          value: 0n,
          value_max: 0n,
          area_shape: 1n,
          area_size: 2n,
          turns: 3n,
        }),
      ],
      { ap_cost: 3n, range_min: 0n, cooldown_turns: 2n }
    )
    const claimed = mob_plays(encode_cell(5n, 5n), encode_cell(5n, 8n), (checkpoint, mob) => {
      mob.kind.snapshot.kit = kit('Snaring Glyph', glyph)
      const second = structuredClone(mob)
      second.cell = encode_cell(6n, 8n)
      second.kind.snapshot.kit.push({
        name: 'Fallback Strike',
        ordinal: 1n,
        level: checkpoint.sources.spells.slash!.levels[0]!,
      })
      checkpoint.contract.fighters.push(second)
    })
    expect(of_type(claimed.events, 'glyph_placed')).toHaveLength(1)
    expect(claimed.events).toContainEqual(
      expect.objectContaining({
        type: 'spell_cast',
        payload: expect.objectContaining({ caster: 2n, spell: 'Fallback Strike' }),
      })
    )
    expect(claimed.state.contract.zones.map(({ anchor }) => anchor)).toEqual([encode_cell(5n, 5n)])
  })

  test('mob hits feed a chatiment once per turn up to its cap, and drained points hold the mob for its turns', () => {
    const fed = mob_plays(encode_cell(5n, 5n), encode_cell(5n, 6n), (checkpoint, mob) => {
      Object.assign(checkpoint.contract.fighters[0]!, {
        hp: 300n,
        effects: [{ ...active(EFFECT_KINDS.chatiment, CHANNELS.strength, 60n, 5n), source: 1n }],
      })
      mob.kind.snapshot.kit[0]!.level.effects[0]!.value = 40n
      mob.kind.snapshot.kit[0]!.level.effects[0]!.value_max = 40n
    })
    const gains = (state: HydratedFightCheckpoint) =>
      state.contract.fighters[0]!.effects.filter(({ kind }) => kind === EFFECT_KINDS.add).map(
        ({ value, turns_left }) => [value, turns_left]
      )
    expect(gains(fed.state)).toEqual([[60n, 5n]])
    expect(
      new Set(of_type(fed.events, 'effect_applied').map(({ payload }) => (payload as { effect_id: string }).effect_id))
        .size
    ).toBe(1)
    const again = create_fight({ state: fed.state, mode: 'local', seed: 3n })
    pass(again)
    expect(gains(again.state())).toEqual([
      [60n, 4n],
      [60n, 5n],
    ])

    // A fixed drain empties three mob turns; a glyph drain on the mob's own turn hits the live pool and stays unstored.
    const checkpoint = open_fixture()
    const spelled = with_spells(checkpoint, {
      drain: spell_level([
        effect_row({
          kind: EFFECT_KINDS.fixed_remove,
          element: '',
          value: 100n,
          value_max: 100n,
          target_filter: 1n,
          turns: 3n,
          stat: CHANNELS.ap,
        }),
      ]),
    })
    const drained = started(spelled)
    expect(
      drained.apply({
        type: 'cast_spell',
        fighter: 0n,
        spell: 'drain',
        target_cell: checkpoint.contract.fighters[1]!.cell,
      }).error
    ).toBeNull()
    const mob_casts = Array.from(
      { length: 4 },
      () =>
        of_type(pass(drained).events, 'spell_cast').filter(
          ({ payload }) => (payload as { caster: bigint }).caster === 1n
        ).length
    )
    expect(mob_casts).toEqual([0, 0, 0, 3])

    const sapped = mob_plays(encode_cell(5n, 5n), encode_cell(5n, 6n), (state, mob) => {
      state.sources.players['0xc1']!.wisdom = 1_000n
      state.contract.zones = [
        zone(0n, mob.cell, {
          trap: false,
          turns_left: 3n,
          effects: [
            effect_row({ kind: EFFECT_KINDS.remove, element: '', value: 2n, value_max: 2n, stat: CHANNELS.ap }),
          ],
        }),
      ]
    })
    const contested = of_type(sapped.events, 'points_contested').map(
      ({ payload }) => payload as { target: bigint; removed: bigint }
    )
    expect(contested).toEqual([expect.objectContaining({ target: 1n })])
    expect(of_type(sapped.events, 'spell_cast')).toHaveLength(Number((6n - contested[0]!.removed) / 2n))
    expect(sapped.state.contract.fighters[1]!.effects).toEqual([])
  })
})
