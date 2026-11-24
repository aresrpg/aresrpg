// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fights as the bot plays them: the shared fight twin seated for this wallet, a signed fight turn on a
// fake Sui client, a hero tree that plays its fight, and the class-blind fight profile.
import { expect } from 'bun:test'
import { create_fight, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'
import type { SuiTransport } from '@aresrpg/sdk'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { Transaction, TransactionDataBuilder, type TransactionPlugin } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

import mobs from '../../../seed/content/mobs.json'
import { fixture as fight_checkpoint } from '../../fight/test/helpers.ts'
import { captured, conflict_digest } from '../../sdk/test/helpers/transaction_conflict.ts'
import { create_actor_runtime } from '../src/actor_runtime.ts'
import type { BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import type { CombatProfile } from '../src/combat_profile.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { fight_checkpoint_id, gameplay_json, type GameplayContext } from '../src/gameplay_context.ts'
import type { Grant } from '../src/model.ts'
import { run_observation, run_tick } from '../src/run_runtime.ts'
import type { ControlStore } from '../src/store.ts'
import type { TargetOptions, WorldArea } from '../src/target_constraints.ts'

import { fixture_bot, fixture_config, fixture_key, memory_store, put, runtime_fixture } from './fixture.ts'
import { character } from './fixture_game.ts'

// Fights: the shared fight twin's fixture, seated for this wallet's hero.
export const fight_character_id = `0x${'2'.repeat(64)}`
export const fight_id = `0x${'3'.repeat(64)}`
export const placement = (owner = fixture_bot.address): HydratedFightCheckpoint => {
  const checkpoint = structuredClone(fight_checkpoint())
  const player = checkpoint.contract.fighters[0]!
  if (player.kind.type !== 'player') throw new Error('invalid fixture')
  player.kind.owner = owner
  player.kind.character = fight_character_id
  player.ready = false
  player.cell = 0n
  const mob = checkpoint.contract.fighters[1]!
  mob.cell = 1n
  mob.hp = 1n
  checkpoint.contract.id = fight_id
  checkpoint.contract.placement_ms = 1000n
  checkpoint.sources.players = { [fight_character_id]: checkpoint.sources.players['0xc1']! }
  return checkpoint
}
export const started_fight = (owner?: string) => {
  const checkpoint = placement(owner)
  checkpoint.contract.fighters[0]!.ready = true
  const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
  const result = fight.apply({ type: 'start', observed_ms: 60_000n })
  if (result.error) throw new Error(result.error.code)
  return fight.state()
}
export const row_of = (checkpoint: HydratedFightCheckpoint): FightStateRow =>
  JSON.parse(gameplay_json({ contract: checkpoint.contract, players: checkpoint.sources.players, kolizeum: null }))
export const fighter = (patch: Partial<CharacterRow> = {}): CharacterRow => ({
  ...character,
  id: fight_character_id,
  name: 'Fixture',
  strength: 100,
  equipment: [],
  world: 'incarnam',
  checkpoint_world: 'incarnam',
  kiosk: `0x${'4'.repeat(64)}`,
  kiosk_cap: `0x${'5'.repeat(64)}`,
  custody: 'fight',
  active_fight: { id: fight_id, seat: 0 },
  ...patch,
})

const GAS_COIN = { objectId: `0x${'1'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' }
/** The bot's socket admits a started fight with its hero seated, at a fresh chain clock. */
const admit_fight = async (f: Awaited<ReturnType<typeof runtime_fixture>>, row: FightStateRow, seat: bigint) => {
  await f.send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
  await f.send({ type: 'packet/game_state', frozen: false })
  await f.send({ type: 'packet/connection_accepted', address: f.bot.address })
  await f.send({
    type: 'packet/server_info',
    online: 1,
    online_characters: 1,
    indexing_lag: 0,
    current_epoch: '1',
    chain_timestamp_ms: 63000,
    chain_sample_age_ms: 0,
  })
  await f.send({
    type: 'packet/fight_state',
    fight: fight_id,
    state: row,
    seats: { [fight_character_id]: Number(seat) },
  })
  await f.send({
    type: 'packet/characters',
    characters: [{ id: fight_character_id, custody: 'fight', active_fight: { id: fight_id, seat: Number(seat) } }],
  })
}
/** A fight turn this process signed and left in its lane's envelope, on a fake Sui client that resolves
 * gas, executes and certifies each submission. Interrupted work is seeded in the current process. */
export const signed_fixture = async (store?: ControlStore) => {
  const f = await runtime_fixture(store)
  const state = started_fight(f.bot.address)
  const row = row_of(state)
  const seat = state.contract.queue[Number(state.contract.turn_ptr)]!
  const lane_key = lane_key_for(f.bot)
  const command: Command = {
    fight_baseline: row,
    id: 'signed',
    bot_id: f.bot.id,
    grant_id: f.grant.id,
    lane_key,
    fingerprint: 'original-fixed-intent',
    kind: 'fight_turn',
    payload: {
      character_id: fight_character_id,
      fight: fight_id,
      fighter_idx: String(seat),
      checkpoint_id: fight_checkpoint_id(row),
      actions: [],
    },
    decision_revision: 1,
    observation_revision: 7,
    status: 'executing',
  }
  const tx = new Transaction()
  tx.setSender(f.bot.address)
  tx.setGasPrice(1)
  tx.setGasBudget(1000)
  tx.setGasPayment([GAS_COIN])
  const bytes = await tx.build()
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const signature = new MultiSigPublicKey(fromBase64(f.bot.multisig_public_key)).combinePartialSignatures([
    (await fixture_key.signTransaction(bytes)).signature,
  ])
  const submissions: Uint8Array[] = []
  const receipt = {
    Transaction: {
      digest,
      effects: {
        status: { success: true },
        changedObjects: [],
        gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
      },
      events: [],
    },
  }
  const resolve: TransactionPlugin = async (data, options, next) => {
    const { inputs, gasData: gas_data } = data
    inputs.forEach((input, index) => {
      const unresolved = (input as { UnresolvedObject?: { objectId: string } }).UnresolvedObject
      if (unresolved)
        inputs[index] = {
          $kind: 'Object',
          Object: {
            $kind: 'SharedObject',
            SharedObject: { objectId: unresolved.objectId, initialSharedVersion: '1', mutable: true },
          },
        } as never
    })
    if (!options.onlyTransactionKind) {
      gas_data.price = '1'
      gas_data.budget = '1000'
      gas_data.payment = [GAS_COIN]
    }
    await next()
  }
  const client = {
    core: {
      getBalance: async () => ({ balance: { balance: '10000000000' } }),
      resolveTransactionPlugin: () => resolve,
      getObjects: async ({ objectIds: object_ids }: { objectIds: string[] }) => ({
        objects: object_ids.map((object_id) => ({
          ...GAS_COIN,
          objectId: object_id,
          owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        })),
      }),
      executeTransaction: async (input: { transaction: Uint8Array }) => {
        submissions[submissions.length] = input.transaction
        return {
          Transaction: { ...receipt.Transaction, digest: TransactionDataBuilder.getDigestFromBytes(input.transaction) },
        }
      },
      waitForTransaction: async () => receipt,
    },
  } as unknown as SuiTransport
  const runtime = create_actor_runtime({ ...f.options, sdk_options: { client } })
  await runtime.observe(f.grant, {})
  const lane = (await f.store.read<Lane>(lane_key))!
  await put(f.store, `command:${command.id}`, command)
  await put(f.store, lane_key, {
    ...lane,
    observation_revision: 7,
    decision_revision: 1,
    active_command: command.id,
    latest_command: command.id,
    pending: {
      command_id: command.id,
      grant_id: f.grant.id,
      digest,
      phase: 'signed',
      bytes: Buffer.from(bytes).toString('base64'),
      signatures: [signature],
      gas_budget_mist: '1000',
    },
  })
  return {
    ...f,
    runtime,
    admit: () => admit_fight(f, row, seat),
    bytes,
    digest,
    command,
    lane_key,
    submissions,
    client,
  }
}

type Signed = Awaited<ReturnType<typeof signed_fixture>>
const signed_pass = async (f: Signed) => {
  await f.runtime.tick()
  await f.runtime.settle()
}
/** After a recovery, only a fresh explicit intent signs again, and it signs new bytes. */
export const fresh_intent = async (f: Signed, store: ControlStore, key: string) => {
  await f.runtime.observe(f.grant, {})
  await f.admit()
  await f.runtime.settle()
  const lane = (await store.read<Lane>(f.lane_key))!
  const command = await create_control_service(store, f.options.config, 60000, () => f.clock.now).accept(f.grant, {
    idempotency_key: key,
    kind: 'fight_turn',
    payload: f.command.payload,
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
  })
  await signed_pass(f)
  return (await store.read<Command>(`command:${command.id}`))!
}
export const conflict_recovery = async (base: ControlStore, lose_ack: boolean) => {
  let lost = false
  const store: ControlStore = {
    ...base,
    transaction: async (keys, operation) => {
      const result = await base.transaction(keys, operation)
      const command = await base.read<Command>('command:signed')
      if ([lose_ack, !lost, command?.error === 'transaction_input_consumed'].every(Boolean)) {
        lost = true
        throw new Error('reply lost after durable conflict commit')
      }
      return result
    },
  }
  const f = await signed_fixture(store)
  const [changed, ...unchanged] = captured.Transaction.effects.changedObjects
  const owned = {
    ...changed!,
    objectId: `0x${'1'.repeat(64)}`,
    inputVersion: '1',
    inputDigest: '11111111111111111111111111111111',
    inputOwner: { AddressOwner: f.bot.address },
    outputVersion: '2',
  }
  const effects = { ...captured.Transaction.effects, changedObjects: [owned, ...unchanged] }
  const proof = { ...captured, Transaction: { ...captured.Transaction, effects } }
  const read_objects = f.client.core.getObjects
  Object.assign(f.client.core, {
    waitForTransaction: async () => Promise.reject(new Error('original receipt unavailable')),
    getObjects: async (input: Parameters<typeof read_objects>[0]) => ({
      objects: (await read_objects(input)).objects.map((row) => ({ ...row, previousTransaction: conflict_digest })),
    }),
    getTransaction: async () => proof,
  })
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
  })
  try {
    await signed_pass(f)
    expect([
      (await store.read<Command>('command:signed'))?.status,
      (await store.read<Lane>(f.lane_key))?.pending,
      f.submissions.length,
      lost,
    ]).toEqual(['failed', null, 0, lose_ack])
    expect((await fresh_intent(f, store, 'explicit-new-intent')).status).toBe('completed')
    expect(f.submissions).toHaveLength(1)
    expect(f.submissions[0]).not.toEqual(f.bytes)
  } finally {
    await f.runtime.stop()
  }
}

export const strike_profile: CombatProfile = {
  version: '1',
  intent: 'Strike the nearest enemy.',
  combos: [{ name: 'attack', steps: [{ type: 'strike', target: 'nearest_enemy' }] }],
  rules: [{ when: { type: 'always' }, combo: 'attack' }],
  fallback: 'end_turn',
}
/** The fixture hero runs a tree that plays its fight, then completes, under a live lease. */
export const combat_fixture = async (checkpoint = placement()) => {
  const store = memory_store()
  const config = fixture_config
  const bot = fixture_bot
  const now = 63_000
  const grant: Grant = {
    id: 'grant',
    authority_generation: config.authority_generation,
    owner: bot.owner,
    client_id: 'client',
    bot_id: bot.id,
    network: bot.network,
    address: bot.address,
    descriptor: bot.multisig_public_key,
    generation: bot.generation,
    resource: config.resource,
    scopes: config.scopes,
    policy_revision: bot.policy.revision,
    revoked: false,
    code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
    family: null,
    access: null,
  }
  await put(store, `bot:${bot.id}`, bot)
  await put(store, `grant:${grant.id}`, grant)
  const control = create_control_service(store, config, config.observation_freshness_ms, () => now)
  const lease = await control.acquire(bot, 'actor', 10_000)
  const key = lane_key_for(bot)
  await control.observed(key, 'actor', lease.fence, true)
  // The fixture hero runs a tree that plays its fight, then completes.
  const run: BehaviorRun = {
    id: 'fixture-run',
    bot_id: bot.id,
    grant_id: grant.id,
    lane_key: key,
    character_id: fight_character_id,
    fingerprint: 'fixture',
    script: {
      version: '1',
      objective: { title: 'Fixture fight' },
      tree: {
        type: 'sequence',
        children: [
          {
            type: 'action',
            action: { type: 'combat', profiles: [{ character_id: fight_character_id, profile: strike_profile }] },
          },
          { type: 'complete' },
        ],
      },
    },
    revision: 1,
    execution_fence: lease.fence,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: now,
  }
  await put(store, 'behavior:fixture-run', run)
  await put(store, key, { ...(await store.read<Lane>(key))!, runs: { [fight_character_id]: run.id } })
  const context: GameplayContext = {
    address: bot.address,
    now,
    freshness_ms: config.observation_freshness_ms,
    command: { ...run_observation(run), observation_revision: 1 },
    snapshot: {
      characters: [fighter()],
      fights: { [fight_id]: row_of(checkpoint) },
      fight_phases: {},
      zones: {},
      tracked_zones: {},
      clock: { chain_ms: now, observed_at: now },
      observed_at: now,
      observation_revision: 1,
      ready: true,
      frozen: false,
      indexing_lag: 0,
    },
  }
  const get_run = async () => (await store.read<BehaviorRun>('behavior:fixture-run'))!
  const get_command = async () => (await store.read<Command>(`command:${(await get_run()).last_command_id}`))!
  const tick = async (current = context, requested?: BehaviorRun) =>
    run_tick({
      store,
      config,
      run: requested ?? (await get_run()),
      actor_id: 'actor',
      fence: lease.fence,
      context: current,
      now,
    })
  return {
    store,
    config,
    bot,
    grant,
    control,
    lease,
    key,
    now,
    context,
    get_run,
    get_command,
    tick,
  }
}

/** A fight profile that names no class: hit as often as the turn allows, moving for
 * damage; with nothing hit, walk closer and hit from there. */
export const generic_profile = {
  version: '1',
  intent:
    'Hit with the most damaging weapon strike or spell as often as the turn allows, moving for damage. With nothing hit, walk closer and hit from there. End the turn when no action is legal.',
  combos: [
    {
      name: 'attack',
      steps: [{ type: 'attack', target: 'highest_damage_enemy', position: 'best_damage', repeat: true }],
    },
    { name: 'approach', steps: [{ type: 'move', direction: 'approach' }] },
  ],
  rules: [
    { when: { type: 'always' }, combo: 'attack' },
    { when: { type: 'no_hit_yet' }, combo: 'approach' },
    { when: { type: 'always' }, combo: 'attack' },
  ],
  fallback: 'end_turn',
}

type Tree = Readonly<{
  character: string
  world: string
  /** Where the hero hunts and walks to; the whole world otherwise. */
  area?: WorldArea
  /** The fights its combat leaf and its hunt accept: every fight, and groups of its area, otherwise. */
  target_options?: TargetOptions
  allies?: readonly string[]
  /** The dungeon it raids before anything else. */
  dungeon?: string
  /** The dungeon runs that end it; none otherwise. */
  runs?: number
  /** The fees, in MIST, that end it; none otherwise. */
  fee_cap_mist?: string
  /** The jobs it works before it hunts. */
  jobs?: readonly string[]
}>
/** Values no tally reaches: a cap left out never ends a run. */
const UNCAPPED = { allies: [], runs: Number.MAX_SAFE_INTEGER, fee_cap_mist: '18446744073709551615' } as const
const out_of_fight = (character_id: string) => ({
  type: 'condition',
  condition: { fact: { type: 'fight', character_id }, op: 'eq', value: false },
})
/** A cap ends the run once its hero is out of a fight: a fight in progress is played out first. */
const cap = (character_id: string, condition: object, reason: string) => ({
  type: 'sequence',
  children: [{ type: 'condition', condition }, out_of_fight(character_id), { type: 'complete', reason }],
})
const leaf = (action: object) => ({ type: 'action', action })

/** The one tree the tests bind for a hero, as an AI client authors it: its caps, then an optional raid,
 * the fight, optional work, then the hunt in its area and the walk toward it. */
export const fixture_script = (binding: Tree) => {
  const area = binding.area ?? { world: binding.world }
  // A field passed as undefined is left out, so it keeps its default.
  const chosen = Object.fromEntries(Object.entries(binding).filter(([, value]) => value !== undefined)) as Tree
  const { character, world, allies, runs, fee_cap_mist, target_options, dungeon, jobs } = { ...UNCAPPED, ...chosen }
  const profile = generic_profile
  return {
    version: '1',
    objective: { title: 'Fixture' },
    tree: {
      type: 'loop',
      child: {
        type: 'selector',
        children: [
          cap(character, { type: 'fees_spent', op: 'gte', value: fee_cap_mist }, 'fee_cap_reached'),
          cap(character, { type: 'dungeon_runs', op: 'gte', value: runs }, 'run_cap_reached'),
          ...(dungeon ? [leaf({ type: 'dungeon', character_id: character, world, dungeon, profile, allies })] : []),
          leaf({
            type: 'combat',
            ...(target_options && { target_options }),
            allies,
            profiles: [{ character_id: character, profile }],
          }),
          ...(jobs ? [leaf({ type: 'profession', character_id: character, world, order: 'best_progress', jobs })] : []),
          leaf({
            type: 'engage',
            character_id: character,
            mob_types: mobs.map(({ mob_type }) => mob_type),
            order: 'nearest',
            target_options: target_options ?? { area },
          }),
          leaf({ type: 'discover', character_id: character, world, area, order: 'toward' }),
          leaf({ type: 'discover', character_id: character, world, area, order: 'nearest' }),
        ],
      },
    },
  }
}

/** An archer (class `yogan`) build as an AI client may author one: stat and spell priorities for the
 * `spend_points` leaf, item stats for `equip_owned best_stats`, and a combat profile. Test data only. */
export const archer_build = {
  stats: ['intelligence'],
  spells: ['Magic Arrow', 'Distant Shooting', 'Critical Shooting', 'Powerful Shooting'],
  equipment: ['intelligence', 'vitality', 'wisdom'],
  profile: {
    version: '1',
    intent:
      'Shoot Magic Arrow at the enemy it hurts most, moving for damage when possible. Spend what is left on the learned shooting buffs, then approach. End the turn when no action is legal.',
    combos: [
      {
        name: 'attack',
        steps: [{ type: 'cast', spell: 'Magic Arrow', target: 'highest_damage_enemy', position: 'best_damage' }],
      },
      { name: 'range', steps: [{ type: 'cast', spell: 'Distant Shooting', target: 'self', if_learned: true }] },
      { name: 'critical', steps: [{ type: 'cast', spell: 'Critical Shooting', target: 'self', if_learned: true }] },
      { name: 'power', steps: [{ type: 'cast', spell: 'Powerful Shooting', target: 'self', if_learned: true }] },
      { name: 'approach', steps: [{ type: 'move', direction: 'approach' }] },
    ],
    rules: ['attack', 'range', 'critical', 'power', 'approach'].map((combo) => ({ when: { type: 'always' }, combo })),
    fallback: 'end_turn',
  },
} as const
