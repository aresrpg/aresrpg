// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { CombatRun } from '../src/combat_control.ts'
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
    const command: Command = {
      ...f.command,
      id: 'combat-relay',
      combat_run_id: 'combat-relay',
      status: 'accepted',
      observation_revision: lane.observation_revision,
      decision_revision: lane.decision_revision + 1,
    }
    const run: CombatRun = {
      id: command.combat_run_id!,
      bot_id: f.bot.id,
      grant_id: f.grant.id,
      lane_key: f.lane_key,
      fingerprint: 'accepted-fight',
      fight: String(command.payload.fight),
      profiles: [
        {
          character_id: String(command.payload.character_id),
          revision: 1,
          profile: {
            version: '1',
            intent: 'Approach the enemy',
            combos: [{ name: 'approach', steps: [{ type: 'move', direction: 'approach' }] }],
            rules: [{ when: { type: 'always' }, combo: 'approach' }],
            fallback: 'end_turn',
          },
        },
      ],
      status: 'active',
      actions_started: 1,
      last_command_id: command.id,
      created_at: f.clock.now,
    }
    await put(store, `combat:${run.id}`, run)
    await put(store, `command:${command.id}`, command)
    await put(store, f.lane_key, {
      ...lane,
      active_command: command.id,
      combat_run_id: run.id,
      decision_revision: command.decision_revision,
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
