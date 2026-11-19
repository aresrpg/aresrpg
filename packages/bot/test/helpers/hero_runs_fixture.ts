// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_control_service, lane_key_for, type Command, type Lane } from '../../src/control.ts'
import { run_tick } from '../../src/run_runtime.ts'
import { process_lane_runs } from '../../src/run_actor.ts'
import type { BehaviorRun, BehaviorScript } from '../../src/behavior_script.ts'
import type { ActorSnapshot } from '../../src/actor_snapshot.ts'
import type { Grant } from '../../src/model.ts'
import { id } from '../../../sdk/test/helpers/transport.ts'

import { runtime_fixture } from './runtime_fixture.ts'
import { put } from './control_fixture.ts'
import { profession_context, character, resource } from './profession_fixture.ts'

/** Two heroes of one wallet, their gather trees and one scheduler pass of the wallet's signing queue. */
export const ally = { ...character, id: id(21), name: 'Second hero' }
export const tree = (character_id: string, title = 'Gather'): BehaviorScript => ({
  version: '1',
  objective: { title },
  tree: { type: 'action', action: { type: 'gather', character_id, item_type: resource.item_type, order: 'nearest' } },
})
export const context = (observation_revision: number) => {
  const base = profession_context()
  const tracked = base.snapshot.tracked_zones[character.id]!
  return {
    ...base,
    command: { ...base.command, observation_revision },
    snapshot: {
      ...base.snapshot,
      observation_revision,
      characters: [character, ally],
      tracked_zones: { [character.id]: tracked, [ally.id]: { ...tracked, character_id: ally.id } },
    },
  }
}
export const fixture = async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  const lease = async () => {
    const lane = await control.acquire(f.bot, 'actor', 10000)
    await control.observed(key, 'actor', lane.fence, true)
    return lane.fence
  }
  const first_fence = await lease()
  const start = (character_id: string, grant: Grant = f.grant) =>
    control.start_behavior(grant, {
      idempotency_key: character_id,
      script: tree(character_id),
      decision_revision: 0,
      observation_revision: 1,
    })
  const run = async (run_id: string) => (await f.store.read<BehaviorRun>(`behavior:${run_id}`))!
  const lane = async () => (await f.store.read<Lane>(key))!
  const tick = async (run_id: string, fence = first_fence) =>
    run_tick({
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      fence,
      run: await run(run_id),
      context: context((await lane()).observation_revision),
      now: f.clock.now,
    })
  const command_of = async (run_id: string) =>
    (await f.store.read<Command>(`command:${(await run(run_id)).last_command_id}`))!
  /** The signature settled and its effect is projected: the slot is free again. */
  const settle = async (run_id: string) => {
    const command = await command_of(run_id)
    await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: 'fixture' } })
    await put(f.store, key, { ...(await lane()), active_command: null })
    return command
  }
  const asked: Command[] = []
  /** One scheduler pass of the wallet's signing queue. `connect` stands in for applying a session's watches. */
  const pass = async (observed?: ActorSnapshot, connect = async () => {}) =>
    process_lane_runs(key, {
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      report_failure: f.options.report_failure,
      now: () => f.clock.now,
      snapshot: () => observed,
      session: async (_bot, command) => {
        asked[asked.length] = command
        return { context: context((await lane()).observation_revision), fence: first_fence, connect }
      },
    })
  return { ...f, control, key, first_fence, lease, start, run, lane, tick, command_of, settle, pass, asked }
}
