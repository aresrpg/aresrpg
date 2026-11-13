// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { lane_key_for, type Command, type Lane } from '../src/control.ts'
import type { BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'
import { character, resource } from './helpers/profession_fixture.ts'

const queued_gather = async (scan_limit: number) => {
  const f = await runtime_fixture()
  const runtime = create_actor_runtime({ ...f.options, scan_limit })
  await runtime.observe(f.grant, {})
  await f.admit()
  await f.send({ type: 'packet/game_state', frozen: true })
  const key = lane_key_for(f.bot)
  const lane = (await f.store.read<Lane>(key))!
  const run: BehaviorRun = {
    id: 'objective',
    bot_id: f.bot.id,
    grant_id: f.grant.id,
    lane_key: key,
    fingerprint: 'objective',
    revision: 1,
    script: {
      version: '1',
      objective: { title: 'Gather fixture' },
      tree: {
        type: 'action',
        action: {
          type: 'gather',
          character_id: character.id,
          item_type: resource.item_type,
          order: 'nearest',
        },
      },
    },
    memory: empty_behavior_memory(),
    pending_node: 'root',
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 1,
    last_command_id: 'gather',
    created_at: f.clock.now,
  }
  const command: Command = {
    id: 'gather',
    bot_id: f.bot.id,
    grant_id: f.grant.id,
    lane_key: key,
    fingerprint: 'gather',
    kind: 'gather',
    payload: { character_id: character.id },
    status: 'accepted',
    decision_revision: lane.decision_revision,
    observation_revision: lane.observation_revision,
    run_ref: { kind: 'behavior', id: run.id },
    behavior_binding: { revision: 1, node: 'root' },
  }
  await put(f.store, 'behavior:objective', run)
  await put(f.store, 'command:gather', command)
  await put(f.store, key, { ...lane, run_ref: command.run_ref, active_command: command.id })
  return { ...f, runtime, key }
}
for (const scan_limit of [100, 1]) {
  test(`an accepted command progresses behind its alphabetically earlier objective (page size ${scan_limit})`, async () => {
    const f = await queued_gather(scan_limit)
    try {
      expect((await f.store.scan_pending(scan_limit))[0]).toBe('behavior:objective')
      // No service wake callback is involved: exercise durable discovery after restart.
      for (let tick = 0; tick < 3; tick += 1) {
        await f.runtime.tick()
        await f.runtime.settle()
      }
      const command = (await f.store.read<Command>('command:gather'))!
      // The real command readiness gate must run. Frozen gameplay prevents any submission.
      expect(command).toMatchObject({ status: 'accepted', waiting_for_resume: true })
      expect((await f.store.read<Lane>(f.key))!.pending).toBeNull()
      expect((await f.store.read<BehaviorRun>('behavior:objective'))!.actions_started).toBe(1)
      expect(await f.store.scan_keys('command:', 10)).toEqual(['command:gather'])
      expect(f.errors).toEqual([])
    } finally {
      await f.runtime.stop()
    }
  })
}

test('objective discovery prioritizes its existing envelope recovery without admitting another action', async () => {
  const f = await queued_gather(1)
  try {
    const lane = (await f.store.read<Lane>(f.key))!
    await put(f.store, f.key, {
      ...lane,
      pending: {
        command_id: 'gather',
        grant_id: f.grant.id,
        digest: 'prepared-fixture',
        phase: 'prepared',
        encrypted: 'not-needed-for-prepared-abandonment',
        gas_budget_mist: '100',
      },
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect((await f.store.read<Lane>(f.key))!.pending).toBeNull()
    expect((await f.store.read<Command>('command:gather'))!.status).toBe('failed')
    expect((await f.store.read<BehaviorRun>('behavior:objective'))!.actions_started).toBe(1)
    expect(await f.store.scan_keys('command:', 10)).toEqual(['command:gather'])
    expect(f.errors).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('dependency priority cannot bypass another actor lease', async () => {
  const f = await queued_gather(1)
  try {
    await put(f.store, f.key, {
      ...(await f.store.read<Lane>(f.key))!,
      actor_id: 'other-actor',
      lease_until: f.clock.now + 10000,
    })
    await f.runtime.tick()
    await f.runtime.settle()
    expect((await f.store.read<Command>('command:gather'))!.waiting_for_resume).toBeUndefined()
    expect((await f.store.read<Lane>(f.key))!.active_command).toBe('gather')
  } finally {
    await f.runtime.stop()
  }
})
