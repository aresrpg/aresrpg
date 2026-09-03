// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { GRID_CELLS, mask_get, neighbours } from '../src/combat_grid.ts'
import {
  create_character_source,
  create_fight_state,
  create_mob_snapshot,
  mob_band_scaled,
  mob_centered_band_scaled,
  mob_effect_value_scaled,
  mob_loot_chance_scaled,
  player_max_hp,
} from '../src/create.ts'
import { roll_value } from '../src/damage.ts'
import { create_fight } from '../src/fight.ts'
import { effect_seed } from '../src/fight_math.ts'
import { xp_award_of } from '../src/fighters.ts'
import { fight_path_to, reachable_fight_cells } from '../src/movement.ts'
import { mix } from '../src/prng.ts'
import { normalize_checkpoint } from '../src/normalize.ts'

import { create_fixture } from './helpers.ts'

describe('fight API', () => {
  test('setup construction is deterministic from normalized birth inputs', () => {
    expect(create_fixture().checkpoint).toEqual(create_fixture().checkpoint)
  })

  test('dungeon identity and room remain distinct through checkpoint normalization', () => {
    const { checkpoint } = create_fixture()
    const normalized = normalize_checkpoint({
      ...checkpoint,
      contract: { ...checkpoint.contract, dungeon: 'tangled_aftermath', dungeon_room: '2' },
    })
    expect(normalized.contract).toMatchObject({ dungeon: 'tangled_aftermath', dungeon_room: 2n })
  })
  test('mob birth derives the exact Move band and spell level from template plus scalar', () => {
    const level = (ap_cost: bigint) => ({
      ap_cost,
      range_min: 1n,
      range_max: 1n,
      modifiable_range: false,
      line_of_sight: false,
      line_launch: false,
      free_cell: false,
      casts_per_turn: 0n,
      casts_per_target: 0n,
      cooldown_turns: 0n,
      crit_1_in: 0n,
      effects: [
        {
          kind: 0n,
          element: 'earth',
          value: 100n,
          value_max: 120n,
          area_shape: 0n,
          area_size: 0n,
          target_filter: 1n,
          chance_bp: 10_000n,
          turns: 0n,
          stat: 0n,
        },
      ],
      crit_effects: [],
    })
    const template = {
      mob_type: 'banded',
      level_min: 10n,
      level_max: 20n,
      hp: 1_000n,
      ap: 6n,
      mp: 3n,
      agility: 4n,
      wisdom: 5n,
      earth_res: 32_868n,
      fire_res: 32_668n,
      water_res: 32_768n,
      air_res: 32_768n,
      spells: [{ name: 'bite', level: level(3n) }],
      loot: [{ item_type: 'fang', chance_bp: 5_000n, min_qty: 1n, max_qty: 2n }],
      xp: 500n,
    }
    const low = create_mob_snapshot(template, 0n)
    const high = create_mob_snapshot(template, 100n)

    expect(low).toMatchObject({
      level: 10n,
      max_hp: 600n,
      ap: 6n,
      mp: 3n,
      agility: 2n,
      wisdom: 3n,
      earth_res: 32_828n,
      fire_res: 32_608n,
      xp: 300n,
      loot: [{ item_type: 'fang', chance_bp: 4_000n, min_qty: 1n, max_qty: 2n }],
    })
    expect(low.kit[0]?.level.effects[0]).toMatchObject({ value: 60n, value_max: 72n })
    expect(low.kit[0]).toMatchObject({ ordinal: 1n, level: { ap_cost: 3n } })
    expect(high).toMatchObject({
      level: 20n,
      max_hp: 1_600n,
      ap: 8n,
      mp: 4n,
      agility: 6n,
      wisdom: 8n,
      earth_res: 32_928n,
      fire_res: 32_708n,
      xp: 800n,
      loot: [{ item_type: 'fang', chance_bp: 6_000n, min_qty: 1n, max_qty: 2n }],
    })
    expect(high.kit[0]?.level.effects[0]).toMatchObject({ value: 160n, value_max: 192n })
    expect(high.kit[0]).toMatchObject({ ordinal: 1n, level: { ap_cost: 3n } })
    expect(mob_band_scaled(1_000n, 10n, 20n, 15n)).toBe(1_100n)
    expect(mob_effect_value_scaled(1n, 10n, 20n, 10n)).toBe(1n)
    expect(mob_centered_band_scaled(32_868n, 32_768n, 10n, 20n, 15n)).toBe(32_878n)
    expect(mob_centered_band_scaled(32_668n, 32_768n, 10n, 20n, 15n)).toBe(32_658n)
    expect(mob_loot_chance_scaled(5_000n, 10n, 20n, 15n)).toBe(5_000n)
    expect(mob_loot_chance_scaled(9_000n, 10n, 20n, 20n)).toBe(10_000n)
  })

  test('Retro XP uses the stable player-level snapshots for every winner', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const player = checkpoint.contract.fighters[0]!
    const mob = checkpoint.contract.fighters[1]!
    if (player.kind.type !== 'player' || mob.kind.type !== 'mob') throw new Error('fixture kinds changed')
    player.kind.level = 5n
    checkpoint.sources.players[player.kind.character] = {
      ...checkpoint.sources.players[player.kind.character]!,
      level: 5n,
    }
    mob.kind.snapshot.level = 12n
    mob.kind.snapshot.xp = 1_970n
    for (let index = 2; index <= 6; index += 1) {
      const character = `0xc${index}`
      const teammate = structuredClone(player)
      teammate.kind = { type: 'player', character, owner: `0xa${index}`, level: 5n }
      checkpoint.sources.players[character] = structuredClone(checkpoint.sources.players[player.kind.character]!)
      checkpoint.contract.fighters.push(teammate)
    }
    checkpoint.contract.winner = 0n

    expect(xp_award_of(checkpoint, 0n)).toBe(472n)
    expect(xp_award_of(checkpoint, 6n)).toBe(472n)
  })

  test('the same fighter action has the same result regardless of who delivered it', () => {
    const { checkpoint } = create_fixture()
    const local = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    const relayed = create_fight({ state: checkpoint, mode: 'local', seed: 91n })

    const local_result = local.apply({ type: 'start', observed_ms: 60_000n })
    const relayed_result = relayed.apply({ type: 'start', observed_ms: 60_000n })

    expect(relayed_result).toEqual(local_result)
    expect(relayed.state()).toEqual(local.state())
  })

  test('transform yields the rendering sequence for an input stream', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })

    const events = [...fight.transform([{ type: 'start', observed_ms: 60_000n }])]

    expect(events[0]?.type).toBe('fight_started')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'turn_switched', payload: expect.objectContaining({ to: 0n }) })
    )
  })

  test('simulate_turn feeds deterministic mob witnesses through the normal engine', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })

    const result = fight.simulate_turn({ observed_ms: 63_000n })

    expect(result.error).toBeNull()
    expect(result.events.some(({ type }) => type === 'spell_cast')).toBe(true)
    expect(result.events.flatMap((event) => (event.type === 'turn_switched' ? [event.payload.to] : []))).toEqual([
      1n,
      0n,
    ])
    expect(fight.state().contract.queue[Number(fight.state().contract.turn_ptr)]).toBe(0n)
  })

  test('local mode restores the exact current-turn boundary', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    const started = fight.apply({ type: 'start', observed_ms: 60_000n }).state
    const fighter = started.contract.queue[Number(started.contract.turn_ptr)]!
    const [target] = reachable_fight_cells(started, fighter)
    const path = target === undefined ? null : fight_path_to(started, fighter, target)
    expect(path?.length).toBeGreaterThan(0)
    fight.apply({ type: 'move_to', fighter, path: path! })
    expect(fight.state()).not.toEqual(started)

    const reset = fight.reset_turn()

    expect(reset).toEqual({ state: started, events: [], error: null })
    expect(fight.state()).toEqual(started)
  })

  test('remote mode cannot reset authoritative turn state', () => {
    const fight = create_fight({ state: create_fixture().checkpoint, mode: 'remote' })

    expect(fight.reset_turn().error?.code).toBe('local_mode_required')
  })

  test('cancelling a refused remote boundary preserves its draft and permits a fresh boundary', () => {
    const local = create_fight({ state: create_fixture().checkpoint, mode: 'local', seed: 91n })
    const started = local.apply({ type: 'start', observed_ms: 60_000n }).state
    const remote = create_fight({ state: started, mode: 'remote' })
    const fighter = started.contract.queue[Number(started.contract.turn_ptr)]!
    const target = reachable_fight_cells(started, fighter)[0]!
    const path = fight_path_to(started, fighter, target)!
    remote.apply({ type: 'move_to', fighter, path })
    const drafted = remote.state()
    remote.apply({ type: 'end_turn', fighter, observed_ms: 63_000n })
    expect(remote.awaiting_witness()).toBeTrue()

    expect(remote.cancel_pending_turn()).toEqual({ state: drafted, events: [], error: null })
    expect(remote.awaiting_witness()).toBeFalse()
    expect(remote.apply({ type: 'turn_seed', fighter: 1n, seed: 7n }).error?.code).toBe('unexpected_turn_seed')
    expect(remote.state()).toEqual(drafted)

    remote.apply({ type: 'end_turn', fighter, observed_ms: 63_500n })
    expect(remote.awaiting_witness()).toBeTrue()
  })

  test('streamed mob witnesses reproduce the local turn exactly', () => {
    const { checkpoint } = create_fixture()
    const local = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    local.apply({ type: 'start', observed_ms: 60_000n })
    const started = local.state()
    const remote = create_fight({ state: started, mode: 'remote' })

    const local_result = local.simulate_turn({ observed_ms: 63_000n })
    const first_mob_seed = (mix(91n, 2n) << 32n) | mix(91n, 3n)
    const boundary = remote.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })
    const mob_turn = remote.apply({ type: 'turn_seed', fighter: 1n, seed: first_mob_seed })
    expect(remote.awaiting_witness()).toBeTrue()
    const final_events = remote.replace(local_result.state)

    expect(boundary).toMatchObject({ events: [], error: null })
    expect(mob_turn.error).toBeNull()
    expect([...mob_turn.events, ...final_events]).toEqual([...local_result.events])
    expect(remote.awaiting_witness()).toBeFalse()
    expect(remote.state()).toEqual(local_result.state)
  })

  test('remote start replays a leading mob wave from streamed turn seeds', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const [player, mob] = checkpoint.contract.fighters
    const [player_start] = checkpoint.contract.board.start_cells_b
    const [mob_start] = checkpoint.contract.board.start_cells_a
    player.team = 1n
    player.cell = player_start
    mob.team = 0n
    mob.cell = mob_start
    const local = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    const remote = create_fight({ state: checkpoint, mode: 'remote' })

    const local_result = local.apply({ type: 'start', observed_ms: 60_000n })
    const first_seed = (mix(91n, 0n) << 32n) | mix(91n, 1n)
    const boundary = remote.apply({ type: 'start', observed_ms: 60_000n })
    const witnessed = remote.apply({ type: 'turn_seed', fighter: 1n, seed: first_seed })
    const final_events = remote.replace(local_result.state)

    expect(boundary).toMatchObject({ events: [], error: null })
    expect(witnessed.error).toBeNull()
    expect([...witnessed.events, ...final_events]).toEqual([...local_result.events])
    expect(remote.state()).toEqual(local_result.state)
  })

  test('join actions preserve the two Move door contracts', () => {
    const { checkpoint } = create_fixture()
    const source = checkpoint.sources.players['0xc1']
    const joiner = { team: 0n, hp: 100n, character: '0xc2', owner: '0xa2', source }

    const empty_checkpoint = structuredClone(checkpoint)
    empty_checkpoint.contract.fighters = [empty_checkpoint.contract.fighters[0]]
    const invalid_access = create_fight({ state: empty_checkpoint }).apply({
      type: 'join',
      access: 2n,
      ...joiner,
      team: 1n,
    })
    expect(invalid_access.error?.code).toBe('bad_access')

    const group_checkpoint = structuredClone(checkpoint)
    group_checkpoint.contract.access_a = 1n
    const missing_party = create_fight({ state: group_checkpoint }).apply({ type: 'join', ...joiner })
    expect(missing_party.error?.code).toBe('group_only')

    const grouped = create_fight({ state: group_checkpoint }).apply({
      type: 'join',
      party_members: ['0xc1', '0xc2'],
      ...joiner,
    })
    expect(grouped.error).toBeNull()
    expect(grouped.events).toContainEqual(
      expect.objectContaining({ type: 'fighter_joined', payload: expect.objectContaining({ fighter: 2n }) })
    )

    const opens_group_side = create_fight({ state: empty_checkpoint }).apply({
      type: 'join',
      access: 1n,
      team: 1n,
      hp: 100n,
      character: '0xc2',
      owner: '0xa2',
      source,
    })
    expect(opens_group_side.error).toBeNull()
    expect(opens_group_side.state.contract.access_b).toBe(1n)
  })

  test('forfeit reports persistent hp only when Move writes it back', () => {
    const pvm = create_fight({ state: create_fixture().checkpoint }).apply({ type: 'forfeit', fighter: 0n })
    expect(pvm.events).toContainEqual(
      expect.objectContaining({ type: 'fighter_settled', payload: expect.objectContaining({ persistent_hp: 1n }) })
    )

    const duel_checkpoint = structuredClone(create_fixture().checkpoint)
    const [, opponent] = duel_checkpoint.contract.fighters
    opponent.kind = { type: 'player', character: '0xc2', owner: '0xa2', level: 10n }
    opponent.settled = false
    duel_checkpoint.sources.players['0xc2'] = duel_checkpoint.sources.players['0xc1']
    const duel = create_fight({ state: duel_checkpoint }).apply({ type: 'forfeit', fighter: 0n })
    expect(duel.events).toContainEqual(
      expect.objectContaining({ type: 'fighter_settled', payload: expect.objectContaining({ persistent_hp: null }) })
    )
  })

  test('move_to follows the caller-selected path without substituting another route', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })
    const before = fight.state().contract
    const start = before.fighters[0].cell
    const occupied = new Set(before.fighters.filter(({ dead }) => !dead).map(({ cell }) => cell))
    const first = neighbours(start).find((cell) => !mask_get(before.closed, cell) && !occupied.has(cell))
    const second =
      first === undefined
        ? undefined
        : neighbours(first).find((cell) => cell !== start && !mask_get(before.closed, cell) && !occupied.has(cell))
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    const result = fight.apply({ type: 'move_to', fighter: 0n, path: [first!, second!] })

    expect(result.error).toBeNull()
    expect(result.events.flatMap((event) => (event.type === 'fighter_moved' ? [event.payload.to] : []))).toEqual([
      first!,
      second!,
    ])
    expect(fight.state().contract.fighters[0].cell).toBe(second!)
  })

  test('move_to checks tackle when the submitted path leaves a locker contact', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const open = (cell: bigint) => !mask_get(checkpoint.contract.closed, cell)
    const route = Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).reduce<{
      start: bigint
      contact: bigint
      end: bigint
      locker: bigint
    } | null>((found, start) => {
      if (found || !open(start)) return found
      for (const contact of neighbours(start).filter(open)) {
        for (const end of neighbours(contact).filter((cell) => cell !== start && open(cell))) {
          const locker = neighbours(contact).find(
            (cell) => cell !== start && cell !== end && open(cell) && !neighbours(start).includes(cell)
          )
          if (locker !== undefined) return { start, contact, end, locker }
        }
      }
      return null
    }, null)
    if (!route) throw new Error('fixture board has no tackle route')
    checkpoint.contract.fighters[0].cell = route.start
    checkpoint.contract.fighters[1].cell = route.locker
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })

    const result = fight.apply({ type: 'move_to', fighter: 0n, path: [route.contact, route.end] })

    expect(result.error).toBeNull()
    expect(result.events.flatMap((event) => (event.type === 'tackle_resolved' ? [event.payload.cell] : []))).toEqual([
      route.contact,
    ])
  })

  test('a cast yields cost, cast, then damage in Move mutation order', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })
    const target_cell = fight.state().contract.fighters[1].cell

    const result = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell })

    expect(result.error).toBeNull()
    expect(result.events.map(({ type }) => type)).toEqual(['ap_mp_change', 'spell_cast', 'damage_number'])
    expect(result.events[2]).toMatchObject({ type: 'damage_number', payload: { target: 1n, amount: 40n } })
  })

  test('a caster-only cost lands when a full-health ally is targeted outside the caster area', () => {
    const source = create_character_source({ classe: 'iyashi', level: 48n })
    const full_hp = player_max_hp(source)
    const checkpoint = create_fight_state({
      players: [
        { character: '0xc1', owner: 'local', team: 0n, ready: true, hp: full_hp, source },
        { character: '0xc2', owner: 'local', team: 0n, ready: true, hp: full_hp, source },
        { character: '0xc3', owner: 'other', team: 1n, ready: true, hp: full_hp, source },
      ],
      mobs: [],
      spells: {
        bleeding_word: {
          classe: 'iyashi',
          unlock_level: 48n,
          levels: [
            {
              ap_cost: 2n,
              range_min: 1n,
              range_max: 40n,
              modifiable_range: false,
              line_of_sight: false,
              line_launch: false,
              free_cell: false,
              casts_per_turn: 0n,
              casts_per_target: 0n,
              cooldown_turns: 0n,
              crit_1_in: 0n,
              effects: [
                {
                  kind: 2n,
                  element: 'water',
                  value: 18n,
                  value_max: 18n,
                  area_shape: 0n,
                  area_size: 0n,
                  target_filter: 4n,
                  chance_bp: 10_000n,
                  turns: 0n,
                  stat: 0n,
                },
                {
                  kind: 4n,
                  element: '',
                  value: 18n,
                  value_max: 18n,
                  area_shape: 0n,
                  area_size: 0n,
                  target_filter: 3n,
                  chance_bp: 10_000n,
                  turns: 0n,
                  stat: 12n,
                },
              ],
              crit_effects: [],
            },
          ],
        },
      },
    })
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })

    const result = fight.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'bleeding_word',
      target_cell: fight.state().contract.fighters[1]!.cell,
    })

    expect(result.error).toBeNull()
    expect(result.state.contract.fighters[0]!.hp).toBe(full_hp - 18n)
    expect(result.state.contract.fighters[1]!.hp).toBe(full_hp)
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'damage_number', payload: expect.objectContaining({ target: 0n, amount: 18n }) })
    )
    expect(result.events.some(({ type }) => type === 'heal_number')).toBeFalse()
  })

  test('percent-life damage rolls its authored band before scaling maximum HP', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const row = {
      kind: 1n,
      element: 'earth',
      value: 8n,
      value_max: 11n,
      area_shape: 0n,
      area_size: 0n,
      target_filter: 1n,
      chance_bp: 10_000n,
      turns: 0n,
      stat: 0n,
    }
    checkpoint.sources.spells.percentage = {
      classe: 'senshi',
      unlock_level: 1n,
      levels: [{ ...checkpoint.sources.spells.slash.levels[0]!, effects: [row], crit_effects: [] }],
    }
    checkpoint.contract.round = 1n
    checkpoint.contract.queue = [0n, 1n]
    checkpoint.contract.turn_ptr = 0n
    checkpoint.contract.turn_seed = 7n
    checkpoint.contract.turn_slot = 0n
    checkpoint.contract.fighters[0]!.ap = 6n
    const expected_percentage = roll_value(row, { state: effect_seed(7n, 0n) })
    expect(expected_percentage).toBeGreaterThan(8n)
    const fight = create_fight({ state: checkpoint, mode: 'local' })

    const result = fight.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'percentage',
      target_cell: checkpoint.contract.fighters[1]!.cell,
    })

    expect(result.error).toBeNull()
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'damage_number',
        payload: expect.objectContaining({ target: 1n, amount: expected_percentage }),
      })
    )
  })

  test('a lasting stat effect carries its exact channel, value, and duration', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.sources.spells.focus = {
      classe: 'senshi',
      unlock_level: 1n,
      levels: [
        {
          ...checkpoint.sources.spells.slash.levels[0],
          range_min: 0n,
          effects: [
            {
              kind: 4n,
              element: '',
              value: 10n,
              value_max: 10n,
              area_shape: 0n,
              area_size: 0n,
              target_filter: 4n,
              chance_bp: 10_000n,
              turns: 2n,
              stat: 0n,
            },
          ],
        },
      ],
    }
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })
    const caster_cell = fight.state().contract.fighters[0].cell

    const result = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'focus', target_cell: caster_cell })

    expect(result.events.at(-1)).toMatchObject({
      type: 'effect_applied',
      payload: { target: 0n, channel: 0n, value: 10n, turns: 2n },
    })

    expect(fight.state().contract.fighters[0]?.effects[0]?.turns_left).toBe(2n)
    expect(fight.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n }).error).toBeNull()
    expect(fight.state().contract.fighters[0]?.effects[0]?.turns_left).toBe(1n)
    expect(fight.apply({ type: 'end_turn', fighter: 0n, observed_ms: 100_000n }).error).toBeNull()
    expect(fight.state().contract.fighters[0]?.effects).toEqual([])
  })

  test('an invalid action is atomic and emits nothing', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })
    const before = fight.state()

    const result = fight.apply({ type: 'move_to', fighter: 0n, path: [379n, 0n] })

    expect(result.error?.code).toBe('no_path')
    expect(result.events).toEqual([])
    expect(fight.state()).toEqual(before)
  })

  test('replace adopts an authoritative state without inventing render events', () => {
    const { checkpoint } = create_fixture()
    const fight = create_fight({ state: checkpoint })
    const replacement = structuredClone(checkpoint)
    replacement.contract.round = 7n

    expect(fight.replace(replacement)).toEqual([])
    expect(fight.state().contract.round).toBe(7n)
  })
})
