// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClientPacket } from '@aresrpg/protocol'

import type { create_bot_actor } from './actor.ts'
import type { Command, Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import type { Run } from './run_plan.ts'
import { run_ref_of, run_key } from './run_ref.ts'
import { observation_events } from './actor_snapshot.ts'
import { gameplay_knowledge } from './gameplay_knowledge.ts'
import { fight_checkpoint_id, zone_checkpoint_id, type GameplayContext } from './gameplay.ts'

/** Full snapshots remain the planning baseline; changes reuse the same fenced event ring. */
export const actor_observation = (context: GameplayContext, fence: number) => {
  const {
    snapshot,
    command: { payload },
  } = context
  if (payload.view === 'changes' && payload.after_cursor === undefined) throw new Error('needs_resync')
  const events = observation_events(snapshot, payload.after_cursor, fence, payload.after_fence)
  if (payload.view === 'changes') {
    const { ready, cursor, observation_revision, observed_at, clock, frozen, indexing_lag } = snapshot
    return {
      view: 'changes' as const,
      ready,
      cursor,
      observation_revision,
      observed_at,
      clock,
      frozen,
      indexing_lag,
      events,
    }
  }
  return {
    ...snapshot,
    events,
    checkpoint_ids: Object.fromEntries(
      Object.entries(snapshot.fights).map(([id, row]) => [id, fight_checkpoint_id(row)])
    ),
    zone_checkpoints: Object.fromEntries(
      Object.entries(snapshot.zones)
        .filter(([, row]) => row.spawns !== null)
        .map(([id, row]) => [id, zone_checkpoint_id(row)])
    ),
    planning_context: gameplay_knowledge(context, payload.recipes as readonly string[] | undefined),
  }
}

export const apply_actor_watches = async (
  actor: Pick<ReturnType<typeof create_bot_actor>, 'observe'>,
  command: Pick<Command, 'grant_id' | 'payload'>
) => {
  for (const [name, type] of [
    ['market', 'packet/market_observe'],
    ['prices', 'packet/market_prices_observe'],
  ] as const) {
    if (Object.hasOwn(command.payload, name))
      await actor.observe(command.grant_id, { type, observation: command.payload[name] } as Extract<
        ClientPacket,
        { type: typeof type }
      >)
  }
}

/** Connector visibility derives from the same canonical run reference as execution. */
export const owned_run_observation = async (store: ControlStore, lane: Lane | null, command: Command) => {
  const ref = lane && run_ref_of(lane)
  const run = ref ? await store.read<Run>(run_key(ref)) : null
  const visible = run && [run.grant_id === command.grant_id, run.bot_id === command.bot_id].every(Boolean) ? ref : null
  return {
    run_ref: visible,
    ...Object.fromEntries(
      ['combat', 'profession'].map((kind) => [`${kind}_run_id`, visible && visible.kind === kind ? visible.id : null])
    ),
    state: visible && run!.status !== 'awaiting_ai' ? 'running' : 'awaiting_ai',
    ...(visible ? { run_status: run!.status, issue: run!.issue } : {}),
  }
}
