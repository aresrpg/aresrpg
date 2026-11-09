// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'

test('pause blocks new gameplay; explicit resume needs fresh revisions and no ambiguity', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  try {
    await control.pause(f.grant)
    await expect(control.resume(f.grant, 1, 0)).rejects.toThrow('needs_resync')
    const lane = await control.acquire(f.bot, 'test', 10000)
    await control.observed(key, 'test', lane.fence, true)
    const fresh = (await f.store.read<Lane>(key))!
    await expect(control.resume(f.grant, fresh.decision_revision, 0)).rejects.toThrow('needs_resync')
    await control.resume(f.grant, fresh.decision_revision, fresh.observation_revision)
    expect((await f.store.read<Lane>(key))!.paused).toBe(false)
    await control.pause(f.grant)
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
    await expect(control.resume(f.grant, fresh.decision_revision + 2, fresh.observation_revision)).rejects.toThrow()
  } finally {
    await f.runtime.stop()
  }
})

test('observations recheck identity and live authority without durable read commands', async () => {
  const f = await runtime_fixture()
  const reads: unknown[] = []
  const control = create_control_service(
    f.store,
    f.options.config,
    60000,
    () => f.clock.now,
    async (grant, payload) => {
      reads.push({ grant, payload })
      return { status: 'pending' }
    }
  )
  try {
    const keys = await f.store.scan_keys('', 1000)
    expect(await control.observe(f.grant, { after_cursor: 2 })).toEqual({ status: 'pending' })
    expect(reads).toEqual([{ grant: f.grant, payload: { after_cursor: 2 } }])
    expect(await f.store.scan_keys('', 1000)).toEqual(keys)
    await expect(control.observe({ ...f.grant, bot_id: 'other' }, {})).rejects.toThrow('invalid_token')
    await expect(
      control.accept(f.grant, {
        idempotency_key: 'read',
        kind: 'observe',
        payload: {},
        decision_revision: 0,
        observation_revision: 0,
      })
    ).rejects.toThrow('invalid_action')
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, scopes: ['bot:play'] })
    await expect(control.observe(f.grant, {})).rejects.toThrow('insufficient_scope')
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
    await expect(control.observe(f.grant, {})).rejects.toThrow('invalid_token')
    expect(reads).toHaveLength(1)
    expect(await f.store.scan_keys('command:', 100)).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('unchanged fresh observations retain pending envelopes and receipt/takeover barriers', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  try {
    const lease = await control.acquire(f.bot, 'test', 10000)
    const pending = {
      command_id: 'pending',
      grant_id: f.grant.id,
      phase: 'submitting' as const,
      digest: 'fixture',
      encrypted: 'fixture',
      gas_budget_mist: '100',
    }
    await put(f.store, key, { ...lease, pending })
    await control.observed(key, 'test', lease.fence, true, false)
    expect((await f.store.read<Lane>(key))?.pending).toEqual(pending)
    await expect(
      control.accept(f.grant, {
        idempotency_key: 'must-not-replace-pending',
        kind: 'equip_tool',
        payload: { character_id: `0x${'1'.repeat(64)}`, item_id: `0x${'2'.repeat(64)}` },
        decision_revision: 0,
        observation_revision: 0,
      })
    ).rejects.toThrow('bot_busy_or_paused')
    for (const barrier of [{ reconciliation_command: 'receipt' }, { transport_stopped: true }]) {
      await put(f.store, key, { ...lease, ...barrier })
      await control.observed(key, 'test', lease.fence, true, false)
      expect((await f.store.read<Lane>(key))?.needs_resync).toBe(true)
    }
  } finally {
    await f.runtime.stop()
  }
})
