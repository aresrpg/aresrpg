// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight turns: planning analysis on the twin and a hero tree that plays its fight through settlement.
import { expect, test, describe } from 'bun:test'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS, create_character_source } from '@aresrpg/fight'

import { create_fight, fight_path_to, reachable_fight_cells } from '../../fight/src/index.ts'
import { fixture as fight_fixture } from '../../fight/test/helpers.ts'
import {
  type GameplayExecutor as GameplayActions,
  fight_checkpoint_id,
  gameplay_json,
  type GameplayContext,
  hydrate_gameplay_fight,
} from '../src/gameplay_context.ts'
import { execute_gameplay_actions, type FightTurnPayload, GAMEPLAY_ACTIONS, parse_fight_turn } from '../src/gameplay.ts'
import type { Lane } from '../src/control.ts'
import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { actor_observation } from '../src/actor_observation.ts'
import { fight_planning } from '../src/fight_planning.ts'

import { put } from './fixture.ts'
import { combat_fixture, fight_id, placement, row_of } from './fixture_fight.ts'
import { plan_of } from './fixture_game.ts'

describe('fight planning', () => {
  const character_id = `0x${'2'.repeat(64)}`
  const fight_id = `0x${'3'.repeat(64)}`
  const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
  const fixture = (walls: bigint[] = [], caster = cell(5), target = cell(6)): GameplayContext => {
    const state = structuredClone({ checkpoint: fight_fixture() }.checkpoint)
    state.contract.id = fight_id
    const player = state.contract.fighters[0]!
    if (player.kind.type !== 'player') throw new Error('expected player')
    player.kind.character = character_id
    state.sources.players = {}
    state.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n })
    state.contract.closed = mask_from_cells(walls)
    state.contract.board.shape_mask = mask_from_cells(
      Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
    )
    state.contract.board.obstacles = walls
    state.contract.board.holes = []
    state.contract.round = 1n
    state.contract.queue = [0n, 1n]
    state.contract.turn_ptr = 0n
    state.contract.turn_started_ms = 1_000n
    state.contract.fighters[0]!.cell = caster
    state.contract.fighters[0]!.ap = 6n
    state.contract.fighters[0]!.mp = 3n
    state.contract.fighters[1]!.cell = target
    state.contract.fighters[1]!.hp = 1_000n
    const normalized = create_fight({ state, mode: 'remote' }).state()
    const row = JSON.parse(
      gameplay_json({ contract: normalized.contract, players: normalized.sources.players, kolizeum: null })
    ) as FightStateRow
    return {
      address: '0xa1',
      now: 4_000,
      freshness_ms: 5_000,
      command: { payload: {} } as GameplayContext['command'],
      snapshot: {
        ready: true,
        frozen: false,
        indexing_lag: 0,
        observed_at: 4_000,
        clock: { chain_ms: 4_000, observed_at: 4_000 },
        observation_revision: 0,
        characters: [
          {
            id: character_id,
            custody: 'fight',
            equipment: [],
            jobs: {},
            spells: {},
            active_fight: { id: fight_id, seat: 0 },
          } as unknown as CharacterRow,
        ],
        fights: { [fight_id]: row },
        zones: {},
        tracked_zones: {},
        fight_phases: {},
        kolizeums: [],
        tournaments: [],
      },
    }
  }
  const plan = (context: GameplayContext, actions: FightTurnPayload['actions'] = []) =>
    fight_planning(context, {
      character_id,
      fight: fight_id,
      fighter_idx: '0',
      checkpoint_id: fight_checkpoint_id(context.snapshot.fights[fight_id]!),
      actions,
    })
  const cast = (target = cell(6), spell = 'Tricky Blow'): FightTurnPayload['actions'][number] => ({
    type: 'cast',
    spell,
    target_cell: String(target),
  })

  test('illegal casts report the engine reason and never offer continuation of an invalid prefix', () => {
    for (const [context, action, code] of [
      [fixture(), cast(cell(8)), 'out_of_range'],
      [fixture([cell(6)]), cast(), 'bad_target_cell'],
      [fixture(), cast(BigInt(CONTRACT_CONSTANTS.grid_cells)), 'bad_target_cell'],
      [fixture([cell(6)], cell(5), cell(8)), cast(cell(8), 'Deviousness'), 'no_line_of_sight'],
      [fixture(), cast(cell(6), 'unknown'), 'not_your_spell'],
      [fixture(), cast(cell(6), 'Tricky Trap'), 'bad_target_cell'],
      [fixture(), cast(cell(6, 6), 'Mass Trap'), 'not_in_line'],
    ] as const) {
      const result = plan(context, [action, cast()])
      expect(result.error).toMatchObject({ action_index: 0, code })
      expect(result.events).toEqual([])
      expect(result.next_casts).toEqual([])
    }
    const blocked = plan(fixture([cell(6)], cell(5), cell(8)))
    expect(blocked.next_casts.find(({ spell }) => spell === 'Deviousness')?.target_cells).not.toContain(cell(8))
    expect(plan(fixture([], cell(5), cell(8)), [cast(cell(8), 'Deviousness')]).error).toBeNull()
  })

  test('freshness, identity and current turn gate analysis; observations are JSON-safe predictions', () => {
    const context = fixture([cell(7)])
    expect(() => plan({ ...context, now: 20_000 })).toThrow('needs_resync')
    expect(() => plan({ ...context, address: '0xother' })).toThrow('fight_authority_mismatch')
    const payload = {
      character_id,
      fight: fight_id,
      fighter_idx: '0',
      checkpoint_id: fight_checkpoint_id(context.snapshot.fights[fight_id]!),
      actions: [cast()],
    }
    expect(() => fight_planning(context, { ...payload, checkpoint_id: 'stale' })).toThrow('needs_resync')
    const observed = actor_observation({
      ...context,
      command: { ...context.command, payload: { fight_plan: payload } },
    })
    const wire = JSON.parse(JSON.stringify(observed))
    expect(wire.fight_plan.prediction).toBe(true)
    expect(wire.fight_plan.fighters[1].cell).toBe(String(cell(6)))
    expect(wire.fight_plan.grid.cells.find((entry: { cell: string }) => entry.cell === String(cell(7))).kind).toBe(
      'obstacle'
    )
    const row = context.snapshot.fights[fight_id]!
    row.contract = { ...hydrate_gameplay_fight(row).contract, turn_ptr: 1n }
    expect(() => plan(context)).toThrow('not_active_turn')
  })
})

describe('combat runtime', () => {
  test('an uncertain combat child never admits a replacement transaction', async () => {
    const f = await combat_fixture()
    await f.tick()
    const command = await f.get_command()
    await put(f.store, `command:${command.id}`, { ...command, status: 'uncertain', error: 'fixture failure' })
    await f.tick()
    await f.tick()
    expect(await f.get_run()).toMatchObject({ status: 'awaiting_ai', actions_started: 1, issue: 'command_uncertain' })
    expect(await f.store.scan_keys('command:', 10)).toHaveLength(1)
    expect((await f.store.read<Lane>(f.key))!.active_command).toBe(command.id)
  })

  test('one autonomous fight selects ready, lethal turn and settlement through existing SDK doors and twin', async () => {
    const f = await combat_fixture()
    const fight = create_fight({ state: placement(), mode: 'local', seed: 91n })
    const calls: string[] = []
    const packets: unknown[] = []
    const unexpected = async () => {
      throw new Error('unexpected SDK action')
    }
    const actions: Partial<GameplayActions> = {
      use_consumable: unexpected,
      open_loot_boxes: unexpected,
      claim_loot_batch: unexpected,
      raise_stats: unexpected,
      raise_spell: unexpected,
      equip: unexpected,
      gather: unexpected,
      craft: unexpected,
      resolve_ambush: unexpected,
      search_zone: unexpected,
      engage: unexpected,
      place: unexpected,
      start: unexpected,
      crank: unexpected,
      ready: async ({ fighter_idx }) => {
        calls.push('ready')
        expect(fight.apply({ type: 'ready', fighter: fighter_idx }).error).toBeNull()
        expect(fight.apply({ type: 'start', observed_ms: 60_000n }).error).toBeNull()
        return { digest: 'ready', started: true }
      },
      commit_turn: async ({ actions: draft }) => {
        calls.push('turn')
        for (const action of draft) {
          if (action.type !== 'strike') throw new Error('expected weapon strike')
          expect(
            fight.apply({ type: 'weapon_strike', fighter: action.fighter_idx, target_cell: action.target_cell }).error
          ).toBeNull()
        }
        expect(fight.state().contract.ended).toBe(true)
        return { digest: 'turn', turn_witnesses: [] }
      },
      settle: async () => {
        calls.push('settle')
        return { digest: 'settle' }
      },
    }
    let { context } = f
    for (const expected of ['fight_ready', 'fight_turn', 'fight_settle'] as const) {
      await f.tick(context)
      const command = await f.get_command()
      expect(command.kind).toBe(expected)
      await execute_gameplay_actions({ ...context, command }, actions as GameplayActions, async (packet) => {
        packets.push(packet)
        return true
      })
      await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: expected } })
      await put(f.store, f.key, { ...(await f.store.read<Lane>(f.key))!, active_command: null })
      context = { ...context, snapshot: { ...context.snapshot, fights: { [fight_id]: row_of(fight.state()) } } }
    }
    const returned = { ...context.snapshot.characters[0]!, custody: 'kiosk' as const, active_fight: undefined }
    await f.tick({ ...context, snapshot: { ...context.snapshot, characters: [returned] } })
    expect(await f.get_run()).toMatchObject({ status: 'completed', actions_started: 3 })
    expect(calls).toEqual(['ready', 'turn', 'settle'])
    expect(packets).toHaveLength(1)
    expect(packets[0]).toMatchObject({ type: 'packet/fight_action', fight: fight_id })
    expect((await f.store.read<Lane>(f.key))!.runs).toEqual({})
  })
})

describe('gameplay', () => {
  const address = `0x${'1'.repeat(64)}`
  const character_id = `0x${'2'.repeat(64)}`
  const fight_id = `0x${'3'.repeat(64)}`
  const fixture = (): GameplayContext => {
    const initial = { checkpoint: fight_fixture() }.checkpoint
    const first = initial.contract.fighters[0]!
    if (first.kind.type !== 'player') throw new Error('fixture needs player')
    const state = {
      ...initial,
      contract: {
        ...initial.contract,
        id: fight_id,
        fighters: [
          { ...first, kind: { ...first.kind, owner: address, character: character_id } },
          ...initial.contract.fighters.slice(1),
        ],
      },
      sources: { ...initial.sources, players: { [character_id]: initial.sources.players['0xc1']! } },
    }
    const local = create_fight({ state, mode: 'local', seed: 91n })
    const started = local.apply({ type: 'start', observed_ms: 60_000n })
    if (started.error) throw new Error(started.error.code)
    const row = JSON.parse(
      gameplay_json({ contract: started.state.contract, players: started.state.sources.players, kolizeum: null })
    ) as FightStateRow
    const seat = started.state.contract.queue[Number(started.state.contract.turn_ptr)]!
    const target = reachable_fight_cells(started.state, seat)[0]!
    const path = fight_path_to(started.state, seat, target)!
    const payload: FightTurnPayload = {
      character_id,
      fight: fight_id,
      fighter_idx: seat.toString(),
      checkpoint_id: fight_checkpoint_id(row),
      actions: [{ type: 'move', path: path.map(String) }],
    }
    return {
      address,
      now: 63_000,
      freshness_ms: 5_000,
      command: {
        id: 'command',
        grant_id: 'grant',
        bot_id: 'bot',
        lane_key: 'lane',
        fingerprint: 'fingerprint',
        kind: 'fight_turn',
        payload,
        decision_revision: 1,
        observation_revision: 7,
        status: 'accepted',
      },
      snapshot: {
        zones: {},
        tracked_zones: {},
        characters: [
          { id: character_id, custody: 'fight', active_fight: { id: fight_id, seat: Number(seat) } } as CharacterRow,
        ],
        fight_phases: {},
        kolizeums: [],
        tournaments: [],
        fights: { [fight_id]: row },
        clock: { chain_ms: 63_000, observed_at: 63_000 },
        observed_at: 63_000,
        observation_revision: 7,
        ready: true,
        frozen: false,
        indexing_lag: 0,
      },
    }
  }
  const change_payload = (context: GameplayContext, patch: Record<string, unknown>): GameplayContext => ({
    ...context,
    command: { ...context.command, payload: { ...context.command.payload, ...patch } },
  })

  test('canonical catalog exposes the complete bounded PvE lifecycle and strict nested turn schema', () => {
    expect(Object.keys(GAMEPLAY_ACTIONS)).toEqual([
      'equip_tool',
      'gather',
      'craft',
      'resolve_ambush',
      'open_loot_boxes',
      'claim_loot',
      'raise_stats',
      'raise_spell',
      'equip_item',
      'use_consumable',
      'fight_join',
      'dungeon_enter',
      'dungeon_fight',
      'dungeon_leave',
      'fight_forfeit',
      'tournament_step',
      'kolizeum_join',
      'market_buy',
      'market_sell',
      'market_delist',
      'market_collect',
      'create_character',
      'world_search',
      'fight_engage',
      'fight_place',
      'fight_ready',
      'fight_start',
      'fight_crank',
      'fight_turn',
      'fight_settle',
    ])
    expect(GAMEPLAY_ACTIONS.fight_turn.input_schema.additionalProperties).toBe(false)
    expect(GAMEPLAY_ACTIONS.fight_turn.input_schema.properties?.actions?.items?.oneOf).toHaveLength(3)
    expect<unknown>(GAMEPLAY_ACTIONS.fight_turn.parse(fixture().command.payload)).toEqual(fixture().command.payload)
  })

  test('refuses malformed, unknown, unsafe integer and action-local identity inputs', () => {
    const valid = fixture().command.payload
    for (const patch of [
      { owner: address },
      { fighter_idx: 0 },
      { fighter_idx: '00' },
      { fighter_idx: '-1' },
      { fighter_idx: '18446744073709551616' },
      { fight: '0x123' },
      { actions: null },
      { actions: [{ type: 'script', source: 'bad' }] },
      { actions: [{ type: 'move', path: ['1'], extra: true }] },
      { actions: [{ type: 'cast', spell: 'Compulsion', target_cell: '1', fighter_idx: '0' }] },
      { actions: [{ type: 'strike', target_cell: Number.MAX_SAFE_INTEGER + 1 }] },
      { actions: [{ type: 'move', path: ['1.1'] }] },
    ])
      expect(() => parse_fight_turn({ ...valid, ...patch })).toThrow()
  })

  const execute_fight_turn = (context: GameplayContext, actions: Pick<GameplayActions, 'commit_turn'>) =>
    execute_gameplay_actions(context, actions as never)
  test('refuses wrong character, seat, fight and checkpoint owner before SDK writes', async () => {
    const context = fixture()
    let writes = 0
    const actions = {
      commit_turn: async () => {
        writes += 1
        return { digest: 'unused', turn_witnesses: [] }
      },
    }
    for (const patch of [{ character_id: address }, { fighter_idx: '1' }, { fight: address }])
      await expect(execute_fight_turn(change_payload(context, patch), actions)).rejects.toThrow()
    await expect(execute_fight_turn({ ...context, address: character_id }, actions)).rejects.toThrow(
      'fight_authority_mismatch'
    )
    expect(writes).toBe(0)
  })

  test('refuses stale snapshot, checkpoint, clock, revision and disconnected/frozen state', () => {
    const context = fixture()
    const stale = { ...context.snapshot, observed_at: 58_000 }
    const bad_snapshots = [
      stale,
      { ...context.snapshot, ready: false },
      { ...context.snapshot, frozen: true },
      { ...context.snapshot, indexing_lag: 301 },
      { ...context.snapshot, clock: null },
      { ...context.snapshot, clock: { chain_ms: 63_000, observed_at: 58_000 } },
      { ...context.snapshot, clock: { chain_ms: 63_000.5, observed_at: 63_000 } },
      { ...context.snapshot, observation_revision: 8 },
      { ...context.snapshot, observed_at: 64_000 },
    ]
    for (const snapshot of bad_snapshots) expect(() => plan_of({ ...context, snapshot })).toThrow('needs_resync')
    expect(() => plan_of(change_payload(context, { checkpoint_id: 'older' }))).toThrow('needs_resync')
  })

  test('validated draft packets precede the one SDK commit without a pacing timer', async () => {
    const context = fixture()
    const events: unknown[] = []
    let finish!: () => void
    const finalized = new Promise<void>((resolve) => {
      finish = resolve
    })
    const executing = execute_gameplay_actions(
      context,
      {
        commit_turn: async (input: Parameters<GameplayActions['commit_turn']>[0]) => {
          events.push({ submit: input })
          await finalized
          events.push('finalized')
          return { digest: 'certified' }
        },
      } as unknown as GameplayActions,
      async (packet) => {
        events.push(packet)
        return true
      }
    )
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(events).toEqual([
      {
        type: 'packet/fight_action',
        fight: fight_id,
        action: { type: 'move_to', fighter: '0', path: ['1'], observed_ms: '63000' },
      },
      { submit: { fight: fight_id, actions: [{ type: 'move', path: [1n] }] } },
    ])
    finish()
    expect(await executing).toEqual({ digest: 'certified' })
    expect(events.at(-1)).toBe('finalized')
  })

  test('failed submission rolls back courtesy presentation without retrying the transaction', async () => {
    const packets: unknown[] = []
    let submissions = 0
    const failure = new Error('uncertain digest')
    await expect(
      execute_gameplay_actions(
        fixture(),
        {
          commit_turn: async () => {
            submissions++
            throw failure
          },
        } as unknown as GameplayActions,
        async (packet) => {
          packets.push(packet)
          return true
        }
      )
    ).rejects.toBe(failure)
    expect(submissions).toBe(1)
    expect(packets.at(-1)).toEqual({ type: 'packet/fight_resync', fight: fight_id })
  })
})
