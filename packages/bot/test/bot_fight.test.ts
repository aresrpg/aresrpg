// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight commands: admission against the shared twin, the full PvE lifecycle and turn courtesy packets.
import { expect, test, describe } from 'bun:test'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'
import { type FightCommandInput, type HydratedFightCheckpoint } from '@aresrpg/fight'

import { create_fight } from '../../fight/src/index.ts'
import { fixture as fight_fixture } from '../../fight/test/helpers.ts'
import {
  type GameplayExecutor as GameplayActions,
  fight_checkpoint_id,
  gameplay_json,
  type GameplayContext,
  zone_checkpoint_id,
} from '../src/gameplay_context.ts'
import { execute_gameplay_actions, parse_gameplay_action, type GameplayActionName } from '../src/gameplay.ts'
import type { ZoneSnapshot } from '../src/actor_world.ts'
import { empty_inventory } from '../src/actor_inventory.ts'

import { plan_of } from './fixture_game.ts'

describe('gameplay lifecycle', () => {
  const address = `0x${'1'.repeat(64)}`
  const character_id = `0x${'2'.repeat(64)}`
  const fight_id = `0x${'3'.repeat(64)}`
  const kiosk = `0x${'4'.repeat(64)}`
  const kiosk_cap = `0x${'5'.repeat(64)}`
  const zone: ZoneSnapshot = {
    zone: { world: 'incarnam', zx: 97, zz: 97, seed: '1', searched_at_ms: 1_000, mob_taken: '0', res_taken: [] },
    spawns: {
      type: 'packet/zone_spawns',
      world: 'incarnam',
      zx: 97,
      zz: 97,
      resources: [],
      mobs: [{ index: 0, x: 50_001, z: 50_000, members: [{ mob_type: 'wabbit', level_scalar: 100 }] }],
    },
  }
  const placement = (): HydratedFightCheckpoint => {
    const state = structuredClone({ checkpoint: fight_fixture() }.checkpoint)
    const player = state.contract.fighters[0]!
    const mob = state.contract.fighters[1]!
    if (player.kind.type !== 'player' || mob.kind.type !== 'mob') throw new Error('invalid fixture')
    player.kind.owner = address
    player.kind.character = character_id
    player.ready = false
    player.cell = 2n
    mob.cell = 1n
    mob.hp = 1n
    mob.kind.snapshot.loot = [{ item_type: 'silk', chance_bp: 10_000n, min_qty: 1n, max_qty: 1n }]
    state.contract.id = fight_id
    state.contract.placement_ms = 1_000n
    state.sources.players = { [character_id]: state.sources.players['0xc1']! }
    return state
  }
  const row_of = (state: HydratedFightCheckpoint): FightStateRow =>
    JSON.parse(
      gameplay_json({
        contract: state.contract,
        players: state.sources.players,
        kolizeum: null,
      })
    ) as FightStateRow
  const character = (in_fight = true): CharacterRow => ({
    id: character_id,
    name: 'Fixture',
    classe: 'senshi',
    sex: 'male',
    level: 10,
    experience: '0',
    color_1: 0,
    color_2: 0,
    color_3: 0,
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    available_points: 0,
    spells: {},
    available_spell_points: 0,
    jobs: {},
    world: 'incarnam',
    checkpoint_world: 'incarnam',
    x: 50_000,
    z: 50_000,
    at_ms: 0,
    equipment: [],
    kiosk,
    kiosk_cap,
    custody: in_fight ? 'fight' : 'kiosk',
    ...(in_fight ? { active_fight: { id: fight_id, seat: 0 } } : {}),
  })
  const context_for = (
    kind: GameplayActionName,
    state = placement(),
    extra: Record<string, unknown> = {}
  ): GameplayContext => {
    const row = row_of(state)
    const payload =
      kind === 'world_search'
        ? { character_id, world: 'incarnam', x: 50_001, z: 50_000 }
        : kind === 'fight_engage'
          ? {
              character_id,
              world: 'incarnam',
              zone_x: 97,
              zone_z: 97,
              group_index: '0',
              zone_checkpoint_id: zone_checkpoint_id(zone),
            }
          : { character_id, fight: fight_id, fighter_idx: '0', checkpoint_id: fight_checkpoint_id(row) }
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
        kind,
        payload: { ...payload, ...extra },
        decision_revision: 1,
        observation_revision: 7,
        status: 'accepted',
      },
      snapshot: {
        characters: [character(!['world_search', 'fight_engage'].includes(kind))],
        fight_phases: {},
        kolizeums: [],
        tournaments: [],
        fights: { [fight_id]: row },
        zones: { 'incarnam:97:97': zone },
        tracked_zones: {
          [character_id]: {
            type: 'packet/tracked_zones',
            character_id,
            world: 'incarnam',
            zones: [{ zx: 97, zz: 97 }],
          },
        },
        clock: { chain_ms: 63_000, observed_at: 63_000 },
        observed_at: 63_000,
        observation_revision: 7,
        ready: true,
        frozen: false,
        indexing_lag: 0,
      },
    }
  }
  const patch_payload = (context: GameplayContext, extra: Record<string, unknown>): GameplayContext => ({
    ...context,
    command: { ...context.command, payload: { ...context.command.payload, ...extra } },
  })
  const patch_character = (context: GameplayContext, extra: Partial<CharacterRow>): GameplayContext => ({
    ...context,
    snapshot: { ...context.snapshot, characters: [{ ...context.snapshot.characters[0]!, ...extra }] },
  })
  const started = () => {
    const state = placement()
    state.contract.fighters[0]!.ready = true
    state.contract.fighters[0]!.cell = 0n
    const runtime = create_fight({ state, mode: 'local', seed: 91n })
    const result = runtime.apply({ type: 'start', observed_ms: 60_000n })
    if (result.error) throw new Error(result.error.code)
    return runtime.state()
  }
  const ended = () => {
    const state = started()
    state.contract.ended = true
    state.contract.winner = 0n
    state.contract.fighters[1]!.dead = true
    state.contract.boss_weight = 100n
    return state
  }

  test('all lifecycle commands reject unknown fields, foreign SDK args and malformed identities', () => {
    for (const kind of [
      'world_search',
      'fight_engage',
      'fight_place',
      'fight_ready',
      'fight_start',
      'fight_crank',
      'fight_turn',
      'fight_settle',
    ] as const) {
      const extra = kind === 'fight_place' ? { cell: '0' } : kind === 'fight_turn' ? { actions: [] } : {}
      const { payload } = context_for(kind, placement(), extra).command
      expect<unknown>(parse_gameplay_action(kind, payload)).toEqual(payload)
      for (const field of ['sdkargs', 'mob_types', 'loot', 'custody', 'last', 'boss_rewards', 'owner'])
        expect(() => parse_gameplay_action(kind, { ...payload, [field]: 'injected' })).toThrow()
      expect(() => parse_gameplay_action(kind, { ...payload, character_id: '0xshort' })).toThrow()
    }
    expect(() => parse_gameplay_action('raw_ptb', {})).toThrow('invalid_action')
    expect(() =>
      parse_gameplay_action('fight_engage', { ...context_for('fight_engage').command.payload, zone_x: 0.5 })
    ).toThrow()
    expect(() =>
      parse_gameplay_action('fight_engage', {
        ...context_for('fight_engage').command.payload,
        group_index: '18446744073709551616',
      })
    ).toThrow()
  })

  test('engage binds exact observed population, tracked window, custody and chain travel proof', () => {
    const context = context_for('fight_engage')
    expect(plan_of(context)).toEqual({
      kind: 'fight_engage',
      travel: {
        character_id,
        checkpoint: 'incarnam:50000:50000:0',
        world: 'incarnam',
        x: 50000,
        z: 50000,
        target_x: 50001,
        target_z: 50000,
      },
      input: {
        character_id,
        world: 'incarnam',
        zone_x: 97,
        zone_z: 97,
        group_index: 0n,
        mob_types: ['wabbit'],
        custody: { kiosk, kiosk_cap },
      },
    })
    for (const extra of [
      { custody: 'fight' as const },
      { world: 'other' },
      { checkpoint_world: 'other' },
      { at_ms: 64_000 },
      { kiosk_cap: undefined },
      { dungeon_run: { dungeon: 'test', room: 1 } },
    ])
      expect(() => plan_of(patch_character(context, extra))).toThrow()
    expect(() => plan_of(patch_payload(context, { zone_checkpoint_id: 'stale' }))).toThrow('needs_resync')
    expect(() => plan_of(patch_payload(context, { group_index: '1' }))).toThrow('mob_group_unavailable')
    expect(() => plan_of({ ...context, snapshot: { ...context.snapshot, tracked_zones: {} } })).toThrow('needs_resync')
    // A current view that does not hold the zone is not stale: the refusal says the zone is out of view.
    const elsewhere = Object.fromEntries(
      Object.entries(context.snapshot.tracked_zones).map(([id, window]) => [id, { ...window, zones: [] }])
    )
    expect(() => plan_of({ ...context, snapshot: { ...context.snapshot, tracked_zones: elsewhere } })).toThrow(
      'zone_outside_view'
    )
    const consumed = { ...zone, zone: { ...zone.zone, mob_taken: '1' } }
    expect(() =>
      plan_of({
        ...patch_payload(context, { zone_checkpoint_id: zone_checkpoint_id(consumed) }),
        snapshot: { ...context.snapshot, zones: { 'incarnam:97:97': consumed } },
      })
    ).toThrow('mob_group_unavailable')
    expect(() =>
      plan_of({
        ...context,
        snapshot: { ...context.snapshot, zones: { 'incarnam:97:97': { ...zone, spawns: null } } },
      })
    ).toThrow('needs_resync')
  })

  test('placement, ready and timeouts are gated by the canonical twin and actual observed chain time', () => {
    expect(plan_of(context_for('fight_place', placement(), { cell: '0' })).kind).toBe('fight_place')
    expect(() => plan_of(context_for('fight_place', placement(), { cell: '229' }))).toThrow('bad_cell')
    expect(plan_of(context_for('fight_ready')).kind).toBe('fight_ready')
    const early = context_for('fight_start')
    const snapshot = { ...early.snapshot, clock: { chain_ms: 60_999, observed_at: 60_000 } }
    expect(() => plan_of({ ...early, snapshot })).toThrow('not_ready')
    expect(plan_of(context_for('fight_start')).kind).toBe('fight_start')
    const turn = started()
    expect(() => plan_of(context_for('fight_crank', turn))).toThrow('too_soon')
    const due = context_for('fight_crank', turn)
    expect(
      plan_of({ ...due, snapshot: { ...due.snapshot, clock: { chain_ms: 105_000, observed_at: 63_000 } } }).kind
    ).toBe('fight_crank')
    turn.contract.fighters[0]!.dead = true
    expect(plan_of(context_for('fight_crank', turn)).kind).toBe('fight_crank')
  })

  test('settlement derives canonical loot, custody, boss and final-seat facts without asset substitution', () => {
    expect(plan_of(context_for('fight_settle', ended()))).toEqual({
      kind: 'fight_settle',
      input: {
        fight: fight_id,
        custody: { kiosk, kiosk_cap },
        settlements: [{ fighter_idx: 0n, loot: [{ item_type: 'silk', existing: null }] }],
        last: true,
        boss_rewards: true,
        mode: { type: 'ordinary' },
      },
    })
    // Loot adds to the pile the hero already holds.
    const won = context_for('fight_settle', ended())
    const pile = { id: `0x${'7'.repeat(64)}`, item_type: 'silk', name: 'silk', category: 'resource', level: 1 }
    const held = { ...empty_inventory(), loaded: true, listings: [], trades: [] }
    const inventory = { ...held, items: [{ ...pile, amount: 4, kiosk, version: '1' }] }
    expect(plan_of({ ...won, snapshot: { ...won.snapshot, inventory } })).toMatchObject({
      input: { settlements: [{ loot: [{ item_type: 'silk', existing: pile.id }] }] },
    })
    expect(() => plan_of(context_for('fight_settle', started()))).toThrow('fight_not_ended')
    const lost = ended()
    lost.contract.winner = 1n
    const plan = plan_of(context_for('fight_settle', lost))
    if (plan.kind !== 'fight_settle') throw new Error('expected settlement')
    expect(plan.input.settlements[0]!.loot).toEqual([])
    const others = ended()
    const other = structuredClone(others.contract.fighters[0]!)
    others.contract.fighters.push(other)
    const batch = plan_of(context_for('fight_settle', others))
    if (batch.kind !== 'fight_settle') throw new Error('expected settlement')
    expect(batch.input.last).toBe(false)
    others.contract.fighters[0]!.forfeited = true
    expect(() => plan_of(context_for('fight_settle', others))).toThrow('fight_authority_mismatch')
  })

  test('unsupported managed modes and foreign seats cannot reach any SDK door', async () => {
    const writes: string[] = []
    const reject = async () => {
      writes.push('unexpected')
      return { digest: 'bad' }
    }
    const actions: Partial<GameplayActions> = {
      use_consumable: async () => {
        throw new Error('unexpected consumable')
      },
      open_loot_boxes: async () => {
        throw new Error('unexpected box opening')
      },
      claim_loot_batch: async () => {
        throw new Error('unexpected loot claim')
      },
      raise_spell: async () => {
        throw new Error('unexpected spell allocation')
      },
      raise_stats: async () => {
        throw new Error('unexpected stat allocation')
      },
      equip: async () => {
        throw new Error('unexpected equip')
      },
      gather: async () => {
        throw new Error('unexpected gather')
      },
      craft: async () => {
        throw new Error('unexpected craft')
      },
      resolve_ambush: async () => {
        throw new Error('unexpected ambush')
      },
      search_zone: reject,
      engage: async () => {
        writes.push('unexpected')
        return { digest: 'bad', fight: fight_id }
      },
      place: reject,
      ready: reject,
      start: reject,
      crank: reject,
      commit_turn: async () => ({ ...(await reject()), turn_witnesses: [] }),
      settle: reject,
    }
    // A managed fight with no manager row yet, and a room no command named.
    for (const extra of [{ managed: true }, { managed: true, dungeon: 'test' }]) {
      const state = placement()
      Object.assign(state.contract, extra)
      await expect(
        execute_gameplay_actions(context_for('fight_ready', state), actions as GameplayActions)
      ).rejects.toThrow('unsupported_fight_mode')
    }
    await expect(
      execute_gameplay_actions(
        patch_payload(context_for('fight_ready'), { fighter_idx: '1' }),
        actions as GameplayActions
      )
    ).rejects.toThrow('fight_authority_mismatch')
    expect(writes).toEqual([])
  })

  test('one complete PvE lifecycle uses injected SDK doors and the actual twin, including a lethal draft', async () => {
    const runtime = create_fight({ state: placement(), mode: 'local', seed: 91n })
    const calls: { method: string; input: unknown }[] = []
    const receipt = { digest: 'fixture-certified' }
    const apply = (input: FightCommandInput) => {
      const result = runtime.apply(input)
      if (result.error) throw new Error(result.error.code)
    }
    const actions: Partial<GameplayActions> = {
      use_consumable: async () => {
        throw new Error('unexpected consumable')
      },
      open_loot_boxes: async () => {
        throw new Error('unexpected box opening')
      },
      claim_loot_batch: async () => {
        throw new Error('unexpected loot claim')
      },
      raise_spell: async () => {
        throw new Error('unexpected spell allocation')
      },
      raise_stats: async () => {
        throw new Error('unexpected stat allocation')
      },
      equip: async () => {
        throw new Error('unexpected equip')
      },
      gather: async () => {
        throw new Error('unexpected gather')
      },
      craft: async () => {
        throw new Error('unexpected craft')
      },
      resolve_ambush: async () => {
        throw new Error('unexpected ambush')
      },
      search_zone: async (input) => {
        calls.push({ method: 'search_zone', input })
        return receipt
      },
      engage: async (input) => {
        calls.push({ method: 'engage', input })
        return { ...receipt, fight: fight_id }
      },
      place: async (input) => {
        calls.push({ method: 'place', input })
        apply({ type: 'place', fighter: input.fighter_idx, cell: input.cell })
        return receipt
      },
      ready: async (input) => {
        calls.push({ method: 'ready', input })
        apply({ type: 'ready', fighter: input.fighter_idx })
        apply({ type: 'start', observed_ms: 60_000n })
        return { ...receipt, started: true }
      },
      start: async (input) => {
        calls.push({ method: 'start', input })
        apply({ type: 'start', observed_ms: 63_000n })
        return receipt
      },
      crank: async (input) => {
        calls.push({ method: 'crank', input })
        apply({ type: 'crank', observed_ms: 105_000n })
        return receipt
      },
      commit_turn: async (input) => {
        calls.push({ method: 'commit_turn', input })
        for (const action of input.actions) {
          if (action.type !== 'strike') throw new Error('fixture expects strike')
          apply({ type: 'weapon_strike', fighter: action.fighter_idx, target_cell: action.target_cell })
        }
        return { ...receipt, turn_witnesses: [] }
      },
      settle: async (input) => {
        calls.push({ method: 'settle', input })
        return { ...receipt, closed: true, item_ids: [kiosk] }
      },
    }
    const discovery = context_for('world_search')
    await execute_gameplay_actions(
      { ...discovery, snapshot: { ...discovery.snapshot, zones: {} } },
      actions as GameplayActions
    )
    await execute_gameplay_actions(context_for('fight_engage'), actions as GameplayActions)
    await execute_gameplay_actions(
      context_for('fight_place', runtime.state(), { cell: '0' }),
      actions as GameplayActions
    )
    await execute_gameplay_actions(context_for('fight_ready', runtime.state()), actions as GameplayActions)
    await execute_gameplay_actions(
      context_for('fight_turn', runtime.state(), { actions: [{ type: 'strike', target_cell: '1' }] }),
      actions as GameplayActions
    )
    expect(runtime.state().contract.ended).toBe(true)
    const result = (await execute_gameplay_actions(
      context_for('fight_settle', runtime.state()),
      actions as GameplayActions
    )) as { digest: string }
    expect(result.digest).toBe('fixture-certified')
    expect(calls.map(({ method }) => method)).toEqual([
      'search_zone',
      'engage',
      'place',
      'ready',
      'commit_turn',
      'settle',
    ])
    expect(calls.at(-1)!.input).toMatchObject({
      settlements: [{ fighter_idx: 0n, loot: [{ item_type: 'silk', existing: null }] }],
      last: true,
    })
  })
})
