// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, type Command, type Lane } from '../src/control.ts'
import type { ControlStore } from '../src/store.ts'

import { memory_store } from './helpers/control_fixture.ts'
import { signed_fixture } from './helpers/signed_runtime_fixture.ts'

for (const phase of ['prepared', 'signed'] as const)
  test(`interrupted local ${phase} work is discarded without signing, polling or replay`, async () => {
    const f = await signed_fixture()
    await f.store.transaction([f.lane_key], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase } })
    })
    let polls = 0
    Object.assign(f.client.core, {
      waitForTransaction: async () => {
        polls += 1
        throw new Error('never submitted')
      },
    })
    try {
      await f.runtime.tick()
      await f.runtime.settle()
      expect(f.submissions).toEqual([])
      expect(polls).toBe(0)
      expect(await f.store.read<Command>('command:signed')).toMatchObject({
        status: phase === 'signed' ? 'cancelled' : 'failed',
      })
      expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
    } finally {
      await f.runtime.stop()
    }
  })

test('local submitting uncertainty blocks another send and retains exact digest until receipt', async () => {
  const f = await signed_fixture()
  const receipt = f.client.core.waitForTransaction
  let visible = false
  let polls = 0
  Object.assign(f.client.core, {
    waitForTransaction: async (input: Parameters<typeof receipt>[0]) => {
      polls += 1
      if (!visible) throw new Error('fixture receipt unavailable')
      return receipt(input)
    },
  })
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
  })
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toEqual([])
    expect((await f.store.read<Lane>(f.lane_key))!.pending?.digest).toBe(f.digest)
    visible = true
    await f.runtime.tick()
    await f.runtime.settle()
    expect(polls).toBe(2)
    expect(f.submissions).toEqual([])
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('completed')
    expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
  } finally {
    await f.runtime.stop()
  }
})

type SignedFixture = Awaited<ReturnType<typeof signed_fixture>>
const late_receipt = (f: SignedFixture) => {
  const receipt = f.client.core.waitForTransaction
  const state = { visible: false }
  Object.assign(f.client.core, {
    waitForTransaction: async (input: Parameters<typeof receipt>[0]) => {
      if (!state.visible) throw new Error('fixture receipt unavailable')
      return receipt(input)
    },
  })
  return state
}
// The SDK may await a submitted receipt for longer than one lease; renewal keeps the deployed
// heartbeat-to-lease ratio (10 s / 30 s) meanwhile.
const outlive_lease = async (f: SignedFixture) => {
  for (const _ of [1, 2, 3, 4]) {
    f.clock.now += Math.floor(f.options.lease_ms / 3)
    await f.runtime.renew()
  }
}
const settled_late = async (f: SignedFixture, fence: number) => {
  await f.runtime.tick()
  await f.runtime.settle()
  expect(f.submissions).toEqual([])
  expect((await f.store.read<Command>('command:signed'))!.status).toBe('completed')
  expect((await f.store.read<Command>('command:signed'))?.receipt).toBeDefined()
  expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({ pending: null, fence })
}

// Socket authority ends, but the receipt arrives after more than one lease: this process keeps its evidence.
for (const stopped of ['revoked', 'paused'] as const)
  test(`${stopped} local work never sends, but already-submitting work settles after a late receipt`, async () => {
    const f = await signed_fixture()
    const receipt = late_receipt(f)
    await f.store.transaction([f.lane_key, 'grant:grant'], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, {
        ...lane,
        paused: stopped === 'paused',
        pending: { ...lane.pending!, phase: 'submitting' },
      })
      if (stopped === 'revoked') await tx.put('grant:grant', { ...f.grant, revoked: true })
    })
    try {
      await f.runtime.tick()
      await f.runtime.settle()
      const { fence } = (await f.store.read<Lane>(f.lane_key))!
      await outlive_lease(f)
      receipt.visible = true
      await settled_late(f, fence)
    } finally {
      await f.runtime.stop()
    }
  })

test('one failed heartbeat does not abandon a submitted transaction awaiting its receipt', async () => {
  const base = memory_store()
  const failure = { armed: false }
  const store: ControlStore = {
    ...base,
    transaction: (keys, operation) => {
      // renew() issues the only single-key lane transactions here.
      if (failure.armed && keys.length === 1 && keys[0]!.startsWith('lane:')) {
        failure.armed = false
        return Promise.reject(new Error('control_transaction_conflict'))
      }
      return base.transaction(keys, operation)
    },
  }
  const f = await signed_fixture(store)
  const receipt = late_receipt(f)
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
  })
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    const { fence } = (await f.store.read<Lane>(f.lane_key))!
    failure.armed = true
    await outlive_lease(f)
    receipt.visible = true
    await settled_late(f, fence)
  } finally {
    await f.runtime.stop()
  }
})

test('a lost lease reports its submitted command as uncertain once, never as failed', async () => {
  const f = await signed_fixture()
  late_receipt(f)
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
  })
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    // Nothing renewed the lease: the next tick reopens the lane and the envelope is gone.
    f.clock.now = (await f.store.read<Lane>(f.lane_key))!.lease_until + 1
    await f.runtime.tick()
    await f.runtime.settle()
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('uncertain')
    const reported = f.errors.length
    await f.runtime.tick()
    await f.runtime.settle()
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('uncertain')
    expect(f.errors).toHaveLength(reported)
    expect(f.submissions).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('a server takeover during submission reconciles the exact receipt and never resubmits', async () => {
  const f = await signed_fixture()
  await f.admit()
  await f.runtime.settle()
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
  })
  try {
    f.sockets[0]!.handlers.on_close(4000, 'REPLACED')
    await f.runtime.settle()
    await f.runtime.tick()
    await f.runtime.settle()
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('completed')
    expect((await f.store.read<Lane>(f.lane_key))!.paused).toBeFalsy()
    expect(f.submissions).toEqual([])
    // The socket is a fact: the same lease reconnects it, including after recovery drops it for fresh state.
    await f.runtime.renew()
    expect(f.sockets.length).toBeGreaterThan(1)
    expect(f.sockets.at(-1)!.closed).toBe(false)
    expect(f.submissions).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('replacement actor does not replay the previous owner local signed envelope', async () => {
  const f = await signed_fixture()
  await f.runtime.stop()
  f.clock.now = (await f.store.read<Lane>(f.lane_key))!.lease_until + 1
  const replacement = create_actor_runtime({ ...f.options, actor_id: 'replacement', sdk_options: { client: f.client } })
  try {
    await replacement.observe(f.grant, {})
    expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
    expect(f.submissions).toEqual([])
  } finally {
    await replacement.stop()
  }
})

test('normal SDK certified failure is not overwritten by the runtime catch handler', async () => {
  const f = await signed_fixture()
  const execute = f.client.core.executeTransaction
  f.client.core.executeTransaction = async (...args) => {
    const result = await execute(...args)
    return {
      FailedTransaction: {
        ...result.Transaction!,
        effects: {
          ...result.Transaction!.effects!,
          status: { success: false, error: { message: 'fixture Move abort' } },
        },
      },
    } as typeof result
  }
  try {
    await f.store.transaction([f.lane_key, 'command:signed'], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, { ...lane, pending: null, active_command: null })
      await tx.put('command:signed', { ...f.command, status: 'cancelled' })
    })
    await f.runtime.observe(f.grant, {})
    await f.admit()
    await f.runtime.settle()
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const next = await control.accept(f.grant, {
      idempotency_key: 'certified-failure',
      kind: 'fight_turn',
      payload: f.command.payload,
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toHaveLength(1)
    expect(await f.store.read<Command>(`command:${next.id}`)).toMatchObject({
      status: 'failed',
      result: { success: false, gas_mist: '23' },
    })
    expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({ pending: null, needs_resync: false })
  } finally {
    await f.runtime.stop()
  }
})
