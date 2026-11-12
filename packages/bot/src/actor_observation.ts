// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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
