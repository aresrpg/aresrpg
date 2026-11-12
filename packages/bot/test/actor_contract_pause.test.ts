// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, type Command, type Lane } from '../src/control.ts'

import { signed_fixture } from './helpers/signed_runtime_fixture.ts'

const accepted_fixture = async () => {
  const f = await signed_fixture()
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
  const command = await control.accept(f.grant, {
    idempotency_key: 'pause-before-execution',
    kind: 'fight_turn',
    payload: f.command.payload,
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
  })
  const tick = async () => {
    await f.runtime.tick()
    await f.runtime.settle()
  }
  const freeze = async (frozen: boolean) => {
    await f.send({ type: 'packet/game_state', frozen })
    await f.runtime.settle()
  }
  return { ...f, original: f.command, command, control, tick, freeze }
}

test('accepted gameplay silently waits for contract resume and executes its original intent once', async () => {
  const f = await accepted_fixture()
  try {
    await f.freeze(true)
    for (let i = 0; i < 3; i++) await f.tick()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(0)
    expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({ status: 'accepted' })
    await f.freeze(false)
    await f.tick()
    await f.tick()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(1)
    expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({
      status: 'completed',
      fingerprint: f.command.fingerprint,
      payload: f.command.payload,
    })
  } finally {
    await f.runtime.stop()
  }
})

test('explicit pause wins over contract resume', async () => {
  const f = await accepted_fixture()
  try {
    await f.freeze(true)
    await f.tick()
    await f.control.pause(f.grant)
    await f.tick()
    await f.freeze(false)
    await f.tick()
    expect(f.submissions).toHaveLength(0)
    expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({ status: 'failed' })
  } finally {
    await f.runtime.stop()
  }
})

test('signed recovery waits through a contract pause without replacing the retained bytes', async () => {
  const f = await signed_fixture()
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.send({ type: 'packet/game_state', frozen: true })
    await f.runtime.settle()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(0)
    expect((await f.store.read<Lane>(f.lane_key))!.pending?.digest).toBe(f.digest)
    await f.send({ type: 'packet/game_state', frozen: false })
    await f.runtime.settle()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.submissions).toEqual([f.bytes])
  } finally {
    await f.runtime.stop()
  }
})

for (const reason of ['revoked', 'takeover', 'stale_checkpoint'] as const) {
  test(`contract resume does not revive ${reason} work`, async () => {
    const f = await accepted_fixture()
    try {
      await f.freeze(true)
      await f.tick()
      if (reason === 'revoked')
        await f.store.transaction(['grant:grant'], async (tx) => {
          await tx.put('grant:grant', { ...f.grant, revoked: true })
        })
      if (reason === 'takeover') f.sockets[0]!.handlers.on_close(4000, 'REPLACED')
      if (reason === 'stale_checkpoint') {
        const fight = f.original.fight_baseline!
        await f.send({
          type: 'packet/fight_state',
          fight: f.command.payload.fight,
          state: { ...fight, contract: { ...(fight.contract as Record<string, unknown>), turn_ptr: '99' } },
          seats: {},
        })
      }
      if (reason !== 'takeover') await f.freeze(false)
      await f.tick()
      await f.tick()
      expect(f.submissions).toHaveLength(0)
      expect(await f.store.read<Command>(`command:${f.command.id}`)).toMatchObject({ status: 'failed' })
    } finally {
      await f.runtime.stop()
    }
  })
}

for (const sampled of [false, true]) {
  test(`restart retains an accepted intent before or after sampling freeze: ${sampled}`, async () => {
    const f = await accepted_fixture()
    await f.freeze(true)
    if (sampled) await f.tick()
    await f.runtime.stop()
    f.clock.now += f.options.lease_ms + 1
    const restarted = create_actor_runtime({ ...f.options, sdk_options: { client: f.client } })
    try {
      await restarted.tick()
      await restarted.settle()
      expect(f.submissions).toHaveLength(0)
      await f.admit()
      await restarted.settle()
      await restarted.tick()
      await restarted.settle()
      expect(f.errors).toEqual([])
      expect(f.submissions).toHaveLength(1)
    } finally {
      await restarted.stop()
    }
  })
}

test('a contract pause does not block receipt recovery or replay submitted work', async () => {
  const f = await signed_fixture()
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.send({ type: 'packet/game_state', frozen: true })
    await f.runtime.settle()
    await f.store.transaction([f.lane_key], async (tx) => {
      const lane = (await tx.get<Lane>(f.lane_key))!
      await tx.put(f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(0)
    expect(await f.store.read<Command>('command:signed')).toMatchObject({ status: 'completed' })
  } finally {
    await f.runtime.stop()
  }
})

test('resume waits for a fresh clock before revalidating an accepted intent', async () => {
  const f = await accepted_fixture()
  try {
    await f.freeze(true)
    await f.tick()
    f.clock.monotonic += 60001
    await f.freeze(false)
    await f.tick()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(0)
    await f.send({
      type: 'packet/server_info',
      online: 1,
      online_characters: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: 63001,
      chain_sample_age_ms: 0,
    })
    await f.runtime.settle()
    await f.tick()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(1)
  } finally {
    await f.runtime.stop()
  }
})

test('signed recovery silently waits for a fresh heartbeat after contract resume', async () => {
  const f = await signed_fixture()
  try {
    await f.runtime.tick()
    await f.runtime.settle()
    await f.admit()
    await f.send({ type: 'packet/game_state', frozen: true })
    await f.runtime.settle()
    f.clock.monotonic += 60001
    await f.send({ type: 'packet/game_state', frozen: false })
    await f.runtime.settle()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.errors).toEqual([])
    expect(f.submissions).toHaveLength(0)
    await f.send({
      type: 'packet/server_info',
      online: 1,
      online_characters: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: 63001,
      chain_sample_age_ms: 0,
    })
    await f.runtime.settle()
    await f.runtime.tick()
    await f.runtime.settle()
    expect(f.errors).toEqual([])
    expect(f.submissions).toEqual([f.bytes])
  } finally {
    await f.runtime.stop()
  }
})
