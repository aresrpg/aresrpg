// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_redis_store } from '../src/store.ts'
import { create_control_service, type Command, type Lane } from '../src/control.ts'
import { run_tick } from '../src/run_runtime.ts'
import type { BehaviorRun } from '../src/behavior_script.ts'
import { empty_inventory } from '../src/actor_inventory.ts'
import { fold_actor_market } from '../src/actor_market.ts'

import { fixture_redis } from './helpers/redis_fixture.ts'
import { combat_fixture } from './helpers/combat_runtime_fixture.ts'
import { profession_context, character, resource } from './helpers/profession_fixture.ts'

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip
integration('Redis restart reloads the authored script but not execution history', async () => {
  const f = await combat_fixture()
  const first = fixture_redis(url!)
  const second = fixture_redis(url!)
  const namespace = `bot:behavior-fixture:${crypto.randomUUID()}`
  await first.connect()
  const store = create_redis_store(first, namespace)
  const restored = create_redis_store(second, namespace)
  try {
    await store.transaction([`bot:${f.bot.id}`, `grant:${f.grant.id}`], async (tx) => {
      await tx.put(`bot:${f.bot.id}`, f.bot)
      await tx.put(`grant:${f.grant.id}`, f.grant)
    })
    const control = create_control_service(store, f.config, 60000, () => f.now)
    const lease = await control.acquire(f.bot, 'actor', 10000)
    await control.observed(f.key, 'actor', lease.fence, true)
    const observation = { kind: 'offers', category: 'resource', item_type: resource.item_type, request: 1 } as const
    const run = await control.start_behavior(f.grant, {
      idempotency_key: 'persistent',
      decision_revision: 0,
      observation_revision: 1,
      script: {
        version: '1',
        objective: { title: 'Observe then gather' },
        tree: {
          type: 'sequence',
          children: [
            { type: 'action', action: { type: 'observe_market', observation } },
            {
              type: 'action',
              action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
            },
            { type: 'complete' },
          ],
        },
      },
    })
    const base = profession_context()
    const context = {
      ...base,
      snapshot: {
        ...base.snapshot,
        inventory: fold_actor_market(empty_inventory(), {
          type: 'packet/market_slice',
          observation,
          listings: [],
          next_cursor: null,
          kiosk_versions: {},
        }),
      },
    }
    const input = { config: f.config, actor_id: 'actor', fence: lease.fence, context, now: f.now }
    await run_tick({ ...input, store, run })
    const key = `behavior:${run.id}`
    const accepted = (await store.read<BehaviorRun>(key))!
    expect(accepted.memory.completed).toEqual(['root/0'])
    expect(accepted.pending_node).toBe('root/1')
    expect(accepted.actions_started).toBe(1)
    const command = await store.read<Command>(`command:${accepted.last_command_id}`)
    first.close()
    await second.connect()
    const restarted = (await restored.read<BehaviorRun>(key))!
    expect(restarted.script).toEqual(accepted.script)
    expect(restarted).toMatchObject({
      actions_started: 0,
      last_command_id: null,
      pending_node: null,
      memory: { completed: [], selected: {} },
      activation: null,
      consumed_command_id: null,
    })
    expect(await restored.scan_pending(10)).toContain(key)
    expect(await restored.scan_pending(10)).not.toContain(`command:${command!.id}`)
    expect(await restored.read<Command>(`command:${command!.id}`)).toBeNull()
    expect(await second.send('GET', [`${namespace}:record:command:${command!.id}`])).toBeNull()
    const now = f.now + 10001
    const next_control = create_control_service(restored, f.config, 60000, () => now)
    const next_lease = await next_control.acquire(f.bot, 'replacement', 10000)
    const next_input = { config: f.config, store: restored, actor_id: 'replacement', fence: next_lease.fence, now }
    expect(await run_tick({ ...next_input, run: restarted, context })).toBe('waiting')
    await next_control.observed(f.key, 'replacement', next_lease.fence, true)
    const lane = (await restored.read<Lane>(f.key))!
    const fresh = {
      ...context,
      command: { ...context.command, observation_revision: lane.observation_revision },
      snapshot: { ...context.snapshot, observation_revision: lane.observation_revision },
    }
    await run_tick({ ...next_input, run: (await restored.read<BehaviorRun>(key))!, context: fresh })
    const resumed = (await restored.read<BehaviorRun>(key))!
    expect(resumed.actions_started).toBe(1)
    expect(resumed.pending_node).toBe('root/1')
    expect(resumed.last_command_id).not.toBe(command!.id)
    expect(await restored.read<Command>(`command:${command!.id}`)).toBeNull()
    expect(await second.send('PTTL', [`${namespace}:record:${key}`])).toBe(-1)
  } finally {
    const client = second.connected ? second : first
    const active = second.connected ? restored : store
    const keys = await active.scan_keys('', 100)
    await client.send('DEL', [namespace, `${namespace}:pending`, ...keys.map((key) => `${namespace}:record:${key}`)])
    first.close()
    second.close()
  }
})
