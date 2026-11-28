// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Recovery of signed work by the actor runtime, the wallet lease, the submitted-turn latch and the
// durable key names.
import { expect, test } from 'bun:test'
import type { RedisClient } from 'bun'
import { create_fight, fight_turn_identity } from '@aresrpg/fight'
import { mix } from '@aresrpg/fight/prng'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, empty_lane, lane_key_for, type Command, type Lane } from '../src/control.ts'
import {
  assert_fight_reconciled,
  replay_fight_receipt,
  retire_fight_replays,
  settled_fight_replays,
  type FightReplay,
} from '../src/fight_runtime.ts'
import { gameplay_json, hydrate_gameplay_fight } from '../src/gameplay_context.ts'
import { create_redis_store, type ControlStore } from '../src/store.ts'

import { memory_store, put, runtime_fixture } from './fixture.ts'
import { conflict_recovery, fresh_intent, row_of, signed_fixture, started_fight } from './fixture_fight.ts'

type Signed = Awaited<ReturnType<typeof signed_fixture>>
const submitting = (f: Signed, patch: Partial<Lane> = {}) =>
  f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, ...patch, pending: { ...lane.pending!, phase: 'submitting' } })
  })
/** The network answers nothing about the transaction until the test shows it: no receipt by digest, and no
 * reply to the same bytes sent again. Every poll is counted. */
const late_receipt = (f: Signed) => {
  const receipt = f.client.core.waitForTransaction
  const send = f.client.core.executeTransaction
  const state = { visible: false, polls: 0 }
  Object.assign(f.client.core, {
    executeTransaction: async (input: Parameters<typeof send>[0]) => {
      const sent = await send(input)
      if (!state.visible) throw new Error('fixture network silent')
      return sent
    },
    waitForTransaction: async (input: Parameters<typeof receipt>[0]) => {
      state.polls += 1
      if (!state.visible) throw new Error('fixture receipt unavailable')
      return receipt(input)
    },
  })
  return state
}
const pass = async (f: Signed) => {
  await f.runtime.tick()
  await f.runtime.settle()
}
/** Recovery may send the held envelope again, as the same signed bytes only: one digest runs at most once. */
const only_own_bytes = (f: Signed) => f.submissions.every((sent) => Buffer.from(sent).equals(Buffer.from(f.bytes)))
const status = async (f: Signed) => (await f.store.read<Command>('command:signed'))!.status
const lane_of = async (f: Signed) => (await f.store.read<Lane>(f.lane_key))!

test('S22 interrupted local prepared or signed work is discarded without signing, polling or replay; a replacement actor never replays it', async () => {
  for (const phase of ['prepared', 'signed'] as const) {
    const f = await signed_fixture()
    await f.store.transaction([f.lane_key], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase } })
    })
    const receipt = late_receipt(f)
    try {
      await pass(f)
      expect([f.submissions, receipt.polls, await status(f), (await lane_of(f)).pending]).toEqual([
        [],
        0,
        phase === 'signed' ? 'cancelled' : 'failed',
        null,
      ])
    } finally {
      await f.runtime.stop()
    }
  }
  const f = await signed_fixture()
  await f.runtime.stop()
  f.clock.now = (await lane_of(f)).lease_until + 1
  const replacement = create_actor_runtime({ ...f.options, actor_id: 'replacement', sdk_options: { client: f.client } })
  try {
    await replacement.observe(f.grant, {})
    expect([(await lane_of(f)).pending, f.submissions]).toEqual([null, []])
  } finally {
    await replacement.stop()
  }
})

test('S21 a submitting envelope is only ever sent again as its own signed bytes: it waits for its exact receipt through revocation, pause, a failed heartbeat and more than one lease', async () => {
  const outlive_lease = async (f: Signed) => {
    for (const _ of [1, 2, 3, 4]) {
      f.clock.now += Math.floor(f.options.lease_ms / 3)
      await f.runtime.renew()
    }
  }
  for (const stopped of ['none', 'revoked', 'paused', 'heartbeat'] as const) {
    const base = memory_store()
    const failure = { armed: false }
    const store: ControlStore = {
      ...base,
      // renew() issues the only single-key lane transactions here.
      transaction: (keys, operation) => {
        if (failure.armed && keys.length === 1 && keys[0]!.startsWith('lane:')) {
          failure.armed = false
          return Promise.reject(new Error('control_transaction_conflict'))
        }
        return base.transaction(keys, operation)
      },
    }
    const f = await signed_fixture(store)
    const receipt = late_receipt(f)
    await submitting(f, { paused: stopped === 'paused' })
    if (stopped === 'revoked') await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
    try {
      await pass(f)
      expect([only_own_bytes(f), (await lane_of(f)).pending?.digest]).toEqual([true, f.digest])
      const { fence } = await lane_of(f)
      failure.armed = stopped === 'heartbeat'
      await outlive_lease(f)
      receipt.visible = true
      await pass(f)
      expect([stopped, only_own_bytes(f), await status(f)]).toEqual([stopped, true, 'completed'])
      expect((await f.store.read<Command>('command:signed'))?.receipt).toBeDefined()
      expect(await lane_of(f)).toMatchObject({ pending: null, fence })
    } finally {
      await f.runtime.stop()
    }
  }
})

test('S21 a lost lease reports its submitted command uncertain once; a server takeover reconciles the exact receipt and reconnects', async () => {
  const lost = await signed_fixture()
  late_receipt(lost)
  await submitting(lost)
  try {
    await pass(lost)
    lost.clock.now = (await lane_of(lost)).lease_until + 1
    await pass(lost)
    const reported = lost.errors.length
    await pass(lost)
    expect([await status(lost), lost.errors.length, only_own_bytes(lost)]).toEqual(['uncertain', reported, true])
  } finally {
    await lost.runtime.stop()
  }
  const f = await signed_fixture()
  await f.admit()
  await f.runtime.settle()
  await submitting(f)
  try {
    f.sockets[0]!.handlers.on_close(4000, 'REPLACED')
    await f.runtime.settle()
    await pass(f)
    expect([await status(f), Boolean((await lane_of(f)).paused), f.submissions]).toEqual(['completed', false, []])
    // The socket is a fact: the same lease reconnects it, including after recovery drops it for fresh state.
    await f.runtime.renew()
    expect([f.sockets.length > 1, f.sockets.at(-1)!.closed, f.submissions]).toEqual([true, false, []])
  } finally {
    await f.runtime.stop()
  }
})

test('S24 a proven conflict fails the command, even when the commit reply is lost; only a fresh intent signs again', async () => {
  for (const lose_ack of [false, true]) await conflict_recovery(memory_store(), lose_ack)
  // An ordinary certified failure from the SDK is kept as the command's outcome, not overwritten.
  const f = await signed_fixture()
  const execute = f.client.core.executeTransaction
  f.client.core.executeTransaction = async (...args) => {
    const result = await execute(...args)
    const effects = {
      ...result.Transaction!.effects!,
      status: { success: false, error: { message: 'fixture Move abort' } },
    }
    return { FailedTransaction: { ...result.Transaction!, effects } } as typeof result
  }
  try {
    await f.store.transaction([f.lane_key, 'command:signed'], async (tx) => {
      await tx.put(f.lane_key, { ...(await tx.get<Lane>(f.lane_key))!, pending: null, active_command: null })
      await tx.put('command:signed', { ...f.command, status: 'cancelled' })
    })
    expect(await fresh_intent(f, f.store, 'certified-failure')).toMatchObject({
      status: 'failed',
      result: { success: false, gas_mist: '23' },
    })
    expect([f.submissions.length, await lane_of(f)]).toEqual([
      1,
      expect.objectContaining({ pending: null, needs_resync: false }),
    ])
  } finally {
    await f.runtime.stop()
  }
})

test('S25 the submitted-turn latch survives serialization and unrelated metadata; only a canonical continuation or settled exit retires it', () => {
  const local = create_fight({ state: started_fight(), mode: 'local', seed: 91n })
  const row = row_of(local.state())
  const command = {
    kind: 'fight_turn',
    fight_baseline: row,
    payload: {
      character_id: '0x' + '1'.repeat(64),
      fight: '0x' + '2'.repeat(64),
      fighter_idx: '0',
      checkpoint_id: 'fixture',
      actions: [],
    },
  } as unknown as Command
  const restarted = JSON.parse(
    gameplay_json(replay_fight_receipt(command, { Transaction: { digest: 'test', events: [] } })!)
  ) as FightReplay
  expect(restarted.awaiting_witness).toBeTrue()
  expect(() => assert_fight_reconciled(restarted, row)).toThrow('fight_turn_already_submitted')
  expect(() => assert_fight_reconciled(restarted, { ...row, players: { ...row.players } })).toThrow(
    'fight_turn_already_submitted'
  )
  // The chain certified the turn. A twin that cannot replay it must not stop its settlement: the latch
  // stands on the submitted turn alone, and the result is read from the game.
  const refused = { ...command, payload: { ...command.payload, actions: [{ type: 'move', path: ['999'] }] } }
  const certified = replay_fight_receipt(refused as Command, { Transaction: { digest: 'test', events: [] } })!
  expect(certified).toMatchObject({ submitted_turn: restarted.submitted_turn, awaiting_witness: false })
  expect(() => assert_fight_reconciled(certified, row)).toThrow('fight_turn_already_submitted')
  const seed = (mix(91n, 2n) << 32n) | mix(91n, 3n)
  const replay = replay_fight_receipt(command, {
    Transaction: {
      digest: 'test',
      events: [{ type: '0x1::fight::TurnSeedUsed', json: { seat: '1', seed: String(seed) } }],
    },
  })!
  expect(() => assert_fight_reconciled(replay, row)).toThrow('fight_turn_already_submitted')
  const next = local.simulate_turn({ observed_ms: 63000n })
  expect(next.error).toBeNull()
  const canonical = JSON.parse(gameplay_json({ ...row, contract: next.state.contract })) as FightStateRow
  expect(fight_turn_identity(hydrate_gameplay_fight(canonical).contract)).not.toBe(replay.submitted_turn)
  expect(() => assert_fight_reconciled(JSON.parse(gameplay_json(replay)), canonical)).not.toThrow()
  const player = hydrate_gameplay_fight(row).contract.fighters.find(({ kind }) => kind.type === 'player')!
  if (player.kind.type !== 'player') throw new Error('fixture player missing')
  const fight = String(command.payload.fight)
  const receipt = { Transaction: { digest: 'test', events: [] } }
  const lane: Lane = {
    ...empty_lane({ address: player.kind.owner, network: 'mainnet' }),
    fight_replays: { [fight]: replay },
  }
  // An old empty row alone cannot erase a certified turn latch.
  expect(retire_fight_replays(lane, [])).toBe(lane)
  const settle = {
    ...command,
    kind: 'fight_settle',
    payload: { ...command.payload, character_id: player.kind.character },
  } as Command
  expect(settled_fight_replays(lane, settle, receipt, false)).toBe(lane.fight_replays)
  const completed = JSON.parse(
    gameplay_json({ ...lane, fight_replays: settled_fight_replays(lane, settle, receipt, true) })
  ) as Lane
  const active = [{ id: player.kind.character, active_fight: { id: fight, seat: 0 } }] as CharacterRow[]
  expect(retire_fight_replays(completed, active)).toBe(completed)
  const pending = { ...completed, pending: { command_id: 'uncertain' } } as Lane
  expect(retire_fight_replays(pending, [])).toBe(pending)
  expect(retire_fight_replays(completed, []).fight_replays).toEqual({})
})

/** Loopback stand-in for the four Redis commands the store issues; `touched` keeps every key name sent. */
const stand_in_redis = () => {
  const records = new Map<string, string>()
  const touched = new Set<string>()
  const read = (key: string) => (touched.add(key), records.get(key) ?? null)
  const commit = (keys: readonly string[], argv: readonly string[]) => {
    const count = Number(argv[0])
    for (let index = 1; index <= count; index += 1) if ((records.get(keys[index + 1]!) ?? '') !== argv[index]) return 0
    for (let index = 1 + count; index < argv.length; index += 4)
      records.set(keys[Number(argv[index]) + 1]!, argv[index + 1]!)
    return 1
  }
  const send = async (command: string, args: readonly string[]) => {
    if (command === 'GET') return read(args[0]!)
    if (command === 'MGET') return args.map(read)
    if (command === 'SCAN') return ['0', [...records.keys()]]
    if (command !== 'EVAL') throw new Error(`unexpected ${command}`)
    const [script, count, ...rest] = args
    rest.slice(0, Number(count)).forEach((key) => touched.add(key))
    if (script!.includes('ZRANGEBYLEX')) return []
    if (!script!.includes("redis.call('MSET'")) return 1
    return commit(rest.slice(0, Number(count)), rest.slice(Number(count)))
  }
  return { send, touched } as unknown as RedisClient & Readonly<{ touched: ReadonlySet<string> }>
}
test('S26 production key names stay exact; a lane releases a settled command and its receipt once nothing it holds names it', async () => {
  // These names hold live data, including encrypted custody seeds: a change here needs a migration.
  const redis = stand_in_redis()
  const names = create_redis_store(redis)
  await names.transaction(['grant:abc'], (tx) => tx.put('grant:abc', { revoked: true }))
  await names.scan_pending(1)
  expect([...redis.touched].toSorted()).toEqual(['bot:control', 'bot:control:pending', 'bot:control:record:grant:abc'])
  expect([await names.scan_keys('grant:', 10), await names.read('grant:abc')]).toEqual([
    ['grant:abc'],
    { revoked: true },
  ])
  const store = create_redis_store(stand_in_redis())
  const f = await runtime_fixture(store)
  const control = create_control_service(store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  const { fence } = await control.acquire(f.bot, 'test', 10000)
  const admit = async (step: number) => {
    await control.observed(key, 'test', fence, true)
    const lane = (await store.read<Lane>(key))!
    const payload = { character_id: `0x${'2'.repeat(64)}`, spending: { vitality: 1 } }
    const input = {
      idempotency_key: `step-${step}`,
      kind: 'raise_stats' as const,
      payload,
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    }
    return control.accept(f.grant, input)
  }
  const settle = (command: Command, digest: string, kiosk?: string) =>
    store.transaction([key, `command:${command.id}`], async (tx) => {
      const lane = (await tx.get<Lane>(key))!
      await tx.put(`command:${command.id}`, {
        ...command,
        status: 'completed',
        result: { digest },
        receipt: { Transaction: { digest } },
      })
      const proof = kiosk ? { [kiosk]: { digest, version: digest, command_id: command.id } } : {}
      await tx.put(key, { ...lane, active_command: null, catalogue_receipts: { ...lane.catalogue_receipts, ...proof } })
    })
  try {
    const first = await admit(1)
    await settle(first, 'first-digest')
    expect(await control.status(f.grant, first.id)).toMatchObject({ status: 'completed' })
    const second = await admit(2)
    expect(await store.read(`command:${first.id}`)).toBeNull()
    await expect(control.status(f.grant, first.id)).rejects.toThrow('command_not_found')
    expect(await store.scan_pending(10)).toEqual([`command:${second.id}`])
    // A market proof keeps its command and receipt named until a newer proof replaces it.
    await settle(second, 'second-digest', 'kiosk')
    const third = await admit(3)
    expect(await store.read(`command:${second.id}`)).toMatchObject({ status: 'completed' })
    await settle(third, 'third-digest', 'kiosk')
    expect([await store.read(`command:${second.id}`), await store.scan_keys('command:', 10)]).toEqual([
      null,
      [`command:${third.id}`],
    ])
  } finally {
    await f.runtime.stop()
  }
})

test('13 S20 pause fences new play; resume needs fresh revisions; a takeover forgets execution, keeps a stop and fences the old owner', async () => {
  const f = await runtime_fixture()
  const reads: unknown[] = []
  const control = create_control_service(
    f.store,
    f.options.config,
    60000,
    () => f.clock.now,
    async (grant, payload) => {
      reads[reads.length] = { grant, payload }
      return { status: 'pending' }
    }
  )
  const key = lane_key_for(f.bot)
  try {
    const keys = await f.store.scan_keys('', 1000)
    expect(await control.observe(f.grant, { view: 'zones' })).toEqual({ status: 'pending' })
    expect([reads, await f.store.scan_keys('', 1000)]).toEqual([[{ grant: f.grant, payload: { view: 'zones' } }], keys])
    await expect(control.observe({ ...f.grant, bot_id: 'other' }, {})).rejects.toThrow('invalid_token')
    await expect(
      control.accept(f.grant, {
        idempotency_key: 'read',
        kind: 'observe' as never,
        payload: {},
        decision_revision: 0,
        observation_revision: 0,
      })
    ).rejects.toThrow('invalid_action')
    await control.pause(f.grant)
    await expect(control.resume(f.grant, 1, 0)).rejects.toThrow('needs_resync')
    const lease = await control.acquire(f.bot, 'first', 10000)
    await control.observed(key, 'first', lease.fence, true)
    const fresh = (await f.store.read<Lane>(key))!
    await expect(control.resume(f.grant, fresh.decision_revision, 0)).rejects.toThrow('needs_resync')
    await control.resume(f.grant, fresh.decision_revision, fresh.observation_revision)
    expect((await f.store.read<Lane>(key))!.paused).toBe(false)
    // An unchanged observation keeps the envelope; a direct command queues behind it, one at a time.
    const pending = {
      command_id: 'pending',
      grant_id: f.grant.id,
      phase: 'submitting' as const,
      digest: 'fixture',
      bytes: 'fixture',
      gas_budget_mist: '100',
    }
    await put(f.store, key, { ...(await f.store.read<Lane>(key))!, pending })
    await control.observed(key, 'first', lease.fence, true, false)
    const revisions = await f.store.read<Lane>(key)
    const direct = (index: number) =>
      control.accept(f.grant, {
        idempotency_key: `must-not-replace-pending-${index}`,
        kind: 'equip_tool',
        payload: { character_id: `0x${'1'.repeat(64)}`, item_id: `0x${'2'.repeat(64)}` },
        decision_revision: revisions!.decision_revision,
        observation_revision: revisions!.observation_revision,
      })
    const queued = await direct(1)
    expect([queued.status, await f.store.read<Lane>(key)]).toEqual([
      'accepted',
      expect.objectContaining({ pending, active_command: null, direct: queued.id }),
    ])
    await expect(direct(2)).rejects.toThrow('bot_busy_or_paused')
    const dirty = {
      ...(await f.store.read<Lane>(key))!,
      active_command: 'old',
      reconciliation_command: 'old',
      paused: true,
      runs: { hero: 'tree' },
      observed_at: f.clock.now,
    }
    await put(f.store, key, dirty)
    await control.observed(key, 'first', lease.fence, true, false)
    expect((await f.store.read<Lane>(key))?.needs_resync).toBe(true)
    await expect(control.acquire(f.bot, 'second', 10000)).rejects.toThrow('actor_owned')
    f.clock.now += 10001
    expect(await control.acquire(f.bot, 'second', 10000)).toMatchObject({
      actor_id: 'second',
      fence: lease.fence + 1,
      paused: true,
      active_command: null,
      pending: null,
      reconciliation_command: null,
      observed_at: 0,
      needs_resync: true,
      runs: dirty.runs,
    })
    await expect(control.heartbeat(key, 'first', lease.fence, 10000)).rejects.toThrow('actor_fenced')
    await expect(control.observed(key, 'first', lease.fence, true)).rejects.toThrow('actor_fenced')
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, scopes: ['bot:play'] })
    await expect(control.observe(f.grant, {})).rejects.toThrow('insufficient_scope')
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
    await expect(control.observe(f.grant, {})).rejects.toThrow('invalid_token')
    await expect(control.resume(f.grant, 0, 0)).rejects.toThrow()
    expect(reads).toHaveLength(1)
  } finally {
    await f.runtime.stop()
  }
})
