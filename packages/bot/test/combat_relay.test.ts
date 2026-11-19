// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import type { Command, Lane } from '../src/control.ts'

import { memory_store, put } from './helpers/control_fixture.ts'
import { signed_fixture } from './helpers/signed_runtime_fixture.ts'

test('an observation change after action relay refuses preparation but still rolls spectators back', async () => {
  const store = memory_store()
  let before_transaction = async () => {}
  const f = await signed_fixture({
    ...store,
    transaction: async (keys, operation) => {
      await before_transaction()
      return store.transaction(keys, operation)
    },
  })
  try {
    await put(store, 'command:signed', { ...f.command, status: 'cancelled' })
    await put(store, f.lane_key, { ...(await store.read<Lane>(f.lane_key))!, pending: null, active_command: null })
    await f.runtime.observe(f.grant, {})
    await f.admit()
    await f.runtime.settle()
    const lane = (await store.read<Lane>(f.lane_key))!
    const character_id = String(f.command.payload.character_id)
    const command: Command = {
      ...f.command,
      id: 'combat-relay',
      run_id: 'combat-relay',
      behavior_binding: { revision: 1, node: 'root' },
      status: 'accepted',
      observation_revision: lane.observation_revision,
      decision_revision: lane.decision_revision,
    }
    const approach = {
      version: '1' as const,
      intent: 'Approach the enemy',
      combos: [{ name: 'approach', steps: [{ type: 'move' as const, direction: 'approach' as const }] }],
      rules: [{ when: { type: 'always' as const }, combo: 'approach' }],
      fallback: 'end_turn' as const,
    }
    const run: BehaviorRun = {
      id: 'combat-relay',
      bot_id: f.bot.id,
      grant_id: f.grant.id,
      lane_key: f.lane_key,
      character_id,
      fingerprint: 'accepted-fight',
      script: {
        version: '1',
        objective: { title: 'Fight' },
        tree: { type: 'action', action: { type: 'combat', profiles: [{ character_id, profile: approach }] } },
      },
      revision: 1,
      execution_fence: lane.fence,
      memory: empty_behavior_memory(),
      pending_node: 'root',
      activation: { node: 'root', fight: String(command.payload.fight) },
      consumed_command_id: null,
      status: 'active',
      actions_started: 1,
      last_command_id: command.id,
      created_at: f.clock.now,
    }
    await put(store, `behavior:${run.id}`, run)
    await put(store, `command:${command.id}`, command)
    await put(store, f.lane_key, {
      ...lane,
      active_command: command.id,
      runs: { [character_id]: run.id },
      run_commands: { [`behavior:${run.id}`]: command.id },
    })
    let changed_after_relay = false
    before_transaction = async () => {
      if (!f.sockets.at(-1)!.sent.some((raw) => JSON.parse(raw).type === 'packet/fight_action')) return
      before_transaction = async () => {}
      // Commit an authoritative observation between preview relay and the journal's preparation gate.
      await store.transaction([f.lane_key], async (tx) => {
        const current = (await tx.get<Lane>(f.lane_key))!
        await tx.put(f.lane_key, { ...current, observation_revision: current.observation_revision + 1 })
      })
      changed_after_relay = true
    }
    await f.runtime.wake(`command:${command.id}`)
    await f.runtime.settle()
    expect(changed_after_relay).toBe(true)
    expect(
      f.sockets
        .at(-1)!
        .sent.map((raw) => JSON.parse(raw).type)
        .filter((type) => type.startsWith('packet/fight_'))
    ).toEqual(['packet/fight_action', 'packet/fight_resync'])
    expect(f.submissions).toHaveLength(0)
    expect((await store.read<Lane>(f.lane_key))!.pending).toBeNull()
    expect(await store.read<Command>(`command:${command.id}`)).toMatchObject({ status: 'accepted' })
    expect(f.errors).toHaveLength(1)
    expect(f.errors[0]).toBeInstanceOf(Error)
    expect(f.errors[0]).not.toBeInstanceOf(AggregateError)
    expect((f.errors[0] as Error).message).toBe('execution_not_authorized')
  } finally {
    await f.runtime.stop()
  }
})
