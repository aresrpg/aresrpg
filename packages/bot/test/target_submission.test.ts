// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { FightStateRow } from '@aresrpg/protocol'

import { hydrate_gameplay_fight, gameplay_json } from '../src/gameplay.ts'
import type { Command, Lane } from '../src/control.ts'

import { signed_fixture } from './helpers/signed_runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'

test('constrained command prepared by the real actor refuses signing/submission after an authoritative mob-roster change', async () => {
  const f = await signed_fixture()
  try {
    await put(f.store, 'command:signed', { ...f.command, status: 'cancelled' })
    await put(f.store, f.lane_key, { ...(await f.store.read<Lane>(f.lane_key))!, pending: null, active_command: null })
    await f.admit()
    await f.runtime.settle()
    const original = hydrate_gameplay_fight(f.command.fight_baseline as FightStateRow)
    const mobs = original.contract.fighters.filter(({ kind }) => kind.type === 'mob')
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const command: Command = {
      ...f.command,
      id: 'constrained',
      status: 'accepted',
      payload: { ...f.command.payload, target_options: { min_size: mobs.length, max_size: mobs.length } },
      observation_revision: lane.observation_revision,
      decision_revision: lane.decision_revision + 1,
    }
    await put(f.store, `command:${command.id}`, command)
    await put(f.store, f.lane_key, {
      ...lane,
      active_command: command.id,
      latest_command: command.id,
      decision_revision: command.decision_revision,
    })
    const resolve = f.client.core.resolveTransactionPlugin.bind(f.client.core)
    let changed_after_build = false
    f.client.core.resolveTransactionPlugin = () => async (data, options, next) => {
      await resolve()(data, options, next)
      if (options.onlyTransactionKind || changed_after_build) return
      changed_after_build = true
      const changed = {
        ...original,
        contract: { ...original.contract, fighters: [...original.contract.fighters, { ...mobs[0]!, dead: true }] },
      }
      await f.send({
        type: 'packet/fight_state',
        fight: String(command.payload.fight),
        state: JSON.parse(
          gameplay_json({ contract: changed.contract, players: changed.sources.players, kolizeum: null })
        ),
        seats: { [String(command.payload.character_id)]: Number(command.payload.fighter_idx) },
      })
    }
    await f.runtime.wake(`command:${command.id}`)
    await f.runtime.settle()
    expect(changed_after_build).toBe(true)
    expect(f.submissions).toHaveLength(0)
    expect(f.errors.map(String).join()).toContain('durable transaction requires reconciliation')
    expect((await f.store.read<Command>(`command:${command.id}`))?.payload.target_options).toEqual({
      min_size: mobs.length,
      max_size: mobs.length,
    })
  } finally {
    await f.runtime.stop()
  }
})
