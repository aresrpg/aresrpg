// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, type Command, type Lane } from '../src/control.ts'

import { signed_fixture } from './helpers/signed_runtime_fixture.ts'

test('restart revalidates unchanged checkpoint then submits only the persisted signed envelope', async () => {
  const f = await signed_fixture()
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toHaveLength(0)
    await f.admit()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.errors).toEqual([])
    expect(f.submissions).toEqual([f.bytes])
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('completed')
    expect((await f.store.read<Command>('command:signed'))!.observation_revision).toBeGreaterThan(7)
    expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
  } finally {
    await f.runtime.stop()
  }
})

test('settled recovery retains the submitted turn latch across a fresh socket baseline', async () => {
  const f = await signed_fixture()
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toHaveLength(1)
    await f.runtime.renew()
    await f.admit()
    await f.runtime.settle()
    await f.send({ type: 'packet/item_removed', item: '0x' + '9'.repeat(64), version: '99' })
    await f.runtime.settle()
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const input = {
      idempotency_key: 'new-command',
      kind: 'fight_turn' as const,
      payload: f.command.payload,
      decision_revision: lane.decision_revision,
      observation_revision: 7,
    }
    await expect(control.accept(f.grant, input)).rejects.toThrow('needs_resync')
    await expect(
      control.accept(f.grant, { ...input, observation_revision: lane.observation_revision })
    ).rejects.toThrow('needs_resync')
    expect(f.submissions).toHaveLength(1)
    expect(f.sockets).toHaveLength(2)
    expect(f.sockets.at(-1)!.closed).toBe(false)
    expect(await f.store.scan_pending(100)).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('submitting uncertainty never resubmits or clears the unresolved envelope', async () => {
  const f = await signed_fixture()
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
  })
  Object.assign(f.client.core, {
    waitForTransaction: async () => {
      throw new Error('fixture receipt unavailable')
    },
  })
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toEqual([])
    expect((await f.store.read<Lane>(f.lane_key))!.pending?.digest).toBe(f.digest)
    expect((await f.store.read<Lane>(f.lane_key))!.pending?.phase).toBe('submitting')
  } finally {
    await f.runtime.stop()
  }
})

test('revoked signed work cancels before submission without inventing a chain receipt', async () => {
  const f = await signed_fixture()
  await f.store.transaction(['grant:grant'], async (tx) => {
    await tx.put('grant:grant', { ...f.grant, revoked: true })
  })
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toEqual([])
    expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('cancelled')
  } finally {
    await f.runtime.stop()
  }
})

test('prepared-only restart fails the original command without polling or submitting and releases the lane', async () => {
  const f = await signed_fixture()
  await f.store.transaction([f.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    const encrypted = await f.options.cipher.encrypt(
      JSON.stringify({ bytes: Buffer.from(f.bytes).toString('base64') }),
      JSON.stringify([f.lane_key, f.command.id, f.digest])
    )
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'prepared', encrypted } })
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
    expect(polls).toBe(0)
    expect(f.submissions).toEqual([])
    expect(f.errors).toEqual([])
    expect(await f.store.read<Command>('command:signed')).toMatchObject({
      status: 'failed',
      error: 'preparation_abandoned',
    })
    expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({
      pending: null,
      active_command: null,
      needs_resync: true,
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect(polls).toBe(0)
    expect(f.submissions).toEqual([])
    await f.runtime.renew()
    await f.admit()
    await f.runtime.settle()
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const next = await control.accept(f.grant, {
      idempotency_key: 'fresh-after-abandon',
      kind: 'fight_turn',
      payload: f.command.payload,
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(1)
    expect((await f.store.read<Command>(`command:${next.id}`))?.status).toBe('completed')
    expect((await f.store.read<Command>('command:signed'))?.status).toBe('failed')
  } finally {
    await f.runtime.stop()
  }
})

test('pause cancels only definitively unsubmitted signed work and permits explicit fresh resume', async () => {
  const f = await signed_fixture()
  let polls = 0
  Object.assign(f.client.core, {
    waitForTransaction: async () => {
      polls += 1
      throw new Error('not submitted')
    },
  })
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.runtime.settle()
    await control.pause(f.grant)
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toEqual([])
    expect(polls).toBe(0)
    expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
    expect(await f.store.read<Command>('command:signed')).toMatchObject({
      status: 'cancelled',
      fingerprint: f.command.fingerprint,
    })
    await f.runtime.renew()
    await f.admit()
    await f.runtime.settle()
    const paused = (await f.store.read<Lane>(f.lane_key))!
    await control.resume(f.grant, paused.decision_revision, paused.observation_revision)
    const resumed = (await f.store.read<Lane>(f.lane_key))!
    const fresh = await control.accept(f.grant, {
      idempotency_key: 'fresh-after-pause',
      kind: 'fight_turn',
      payload: f.command.payload,
      decision_revision: resumed.decision_revision,
      observation_revision: resumed.observation_revision,
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toHaveLength(1)
    expect((await f.store.read<Command>(`command:${fresh.id}`))!.status).toBe('completed')
  } finally {
    await f.runtime.stop()
  }
})

test('revoked submitting work reacquires recovery ownership after stopped-session lease expiry', async () => {
  const f = await signed_fixture()
  const receipt = f.client.core.waitForTransaction
  let visible = false
  let polls = 0
  Object.assign(f.client.core, {
    waitForTransaction: async (input: Parameters<typeof receipt>[0]) => {
      polls += 1
      if (!visible) throw new Error('receipt not yet visible')
      return receipt(input)
    },
  })
  await f.store.transaction([f.lane_key, 'grant:grant'], async (tx) => {
    const lane = (await tx.get<Lane>(f.lane_key))!
    await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
    await tx.put('grant:grant', { ...f.grant, revoked: true })
  })
  try {
    for (let index = 0; index < 2; index++) {
      await f.runtime.tick()
      await f.runtime.settle()
    }
    expect(polls).toBe(2)
    f.clock.now = (await f.store.read<Lane>(f.lane_key))!.lease_until + 1
    visible = true
    await f.runtime.tick()
    await f.runtime.settle()
    expect(polls).toBe(3)
    expect(f.submissions).toEqual([])
    expect(f.sockets).toEqual([])
    expect((await f.store.read<Lane>(f.lane_key))!.pending).toBeNull()
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('completed')
  } finally {
    await f.runtime.stop()
  }
})

test('receipt recovery preserves terminal human takeover and never reconnects gameplay', async () => {
  const f = await signed_fixture()
  const original_wait = f.client.core.waitForTransaction
  let visible = false
  let polls = 0
  f.client.core.waitForTransaction = async (...args) => {
    polls++
    if (!visible) throw new Error('receipt not visible yet')
    return original_wait(...args)
  }
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.runtime.settle()
    await f.store.transaction([f.lane_key], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
    })
    f.sockets[0]!.handlers.on_close(4000, 'REPLACED')
    await f.runtime.settle()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(polls).toBe(1)
    expect((await f.store.read<Lane>(f.lane_key))!.pending?.phase).toBe('submitting')
    f.clock.now = (await f.store.read<Lane>(f.lane_key))!.lease_until + 1
    visible = true
    await f.runtime.tick()
    await f.runtime.settle()
    await f.runtime.renew()
    await f.runtime.settle()
    expect(polls).toBe(2)
    expect((await f.store.read<Command>('command:signed'))!.status).toBe('completed')
    expect((await f.store.read<Lane>(f.lane_key))!.paused).toBeTrue()
    expect(f.submissions).toHaveLength(0)
    expect(f.sockets).toHaveLength(1)
    await f.runtime.stop()
    const restarted = create_actor_runtime({ ...f.options, sdk_options: { client: f.client } })
    try {
      await expect(restarted.observe(f.grant, {})).rejects.toThrow('ACTOR_TERMINAL')
      await restarted.renew()
      await restarted.settle()
      expect(f.sockets).toHaveLength(1)
    } finally {
      await restarted.stop()
    }
  } finally {
    await f.runtime.stop()
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
