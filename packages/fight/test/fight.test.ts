// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { GRID_CELLS, mask_get, neighbours } from '../src/combat_grid.ts'
import { create_mob_snapshot } from '../src/create.ts'
import { create_fight } from '../src/fight.ts'
import { fight_path_to, reachable_fight_cells } from '../src/movement.ts'
import { mix } from '../src/prng.ts'

import { create_fixture } from './helpers.ts'

describe('fight API', () => {
  test('setup construction is deterministic from normalized birth inputs', () => {
    expect(create_fixture().checkpoint).toEqual(create_fixture().checkpoint)
  })

  test('mob birth derives the exact Move band and spell level from template plus scalar', () => {
    const level = (value: bigint) => ({
      ap_cost: value,
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
      effects: [],
      crit_effects: [],
    })
    const snapshot = create_mob_snapshot(
      {
        mob_type: 'banded',
        level_min: 10n,
        level_max: 20n,
        hp: 1_000n,
        ap: 6n,
        mp: 3n,
        agility: 4n,
        wisdom: 5n,
        earth_res: 32_768n,
        fire_res: 32_768n,
        water_res: 32_768n,
        air_res: 32_768n,
        spells: [{ name: 'bite', levels: [level(1n), level(2n)] }],
        loot: [],
        xp: 500n,
      },
      50n
    )

    expect(snapshot).toMatchObject({ level: 15n, max_hp: 1_050n, xp: 525n })
    expect(snapshot.kit).toEqual([{ name: 'bite', ordinal: 1n, level: level(1n) }])
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
    const final_events = remote.replace(local_result.state)

    expect(boundary).toMatchObject({ events: [], error: null })
    expect(mob_turn.error).toBeNull()
    expect([...mob_turn.events, ...final_events]).toEqual([...local_result.events])
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
    opponent.kind = { type: 'player', character: '0xc2', owner: '0xa2' }
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
              turns: 3n,
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
      payload: { target: 0n, channel: 0n, value: 10n, turns: 3n },
    })
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
