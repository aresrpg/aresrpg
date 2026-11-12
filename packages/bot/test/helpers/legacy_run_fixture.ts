// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ControlStore } from '../../src/store.ts'
import type { Grant } from '../../src/model.ts'
import { lane_key_for, type Lane } from '../../src/control.ts'
import type { ProfessionRun } from '../../src/profession_control.ts'
import type { ProfessionPlan } from '../../src/profession_plan.ts'
import type { CombatRun } from '../../src/combat_control.ts'

const record = (grant: Grant, now: number) => ({
  id: 'historical-fixture',
  bot_id: grant.bot_id,
  grant_id: grant.id,
  lane_key: lane_key_for(grant),
  fingerprint: 'fixture',
  status: 'active' as const,
  actions_started: 0,
  last_command_id: null,
  created_at: now,
})
/** Seed historical persisted records directly; this is not an authoring API or admission emulator. */
const retain = async <T extends ProfessionRun | CombatRun>(
  store: ControlStore,
  kind: 'profession' | 'combat',
  run: T
): Promise<T> => {
  await store.transaction([`${kind}:${run.id}`, run.lane_key], async (tx) => {
    const lane = (await tx.get<Lane>(run.lane_key))!
    await tx.put(`${kind}:${run.id}`, run)
    await tx.put(run.lane_key, { ...lane, [`${kind}_run_id`]: run.id, decision_revision: lane.decision_revision + 1 })
  })
  return run
}
export const stored_profession = (store: ControlStore, grant: Grant, plan: ProfessionPlan, now: number) =>
  retain(store, 'profession', { ...record(grant, now), plan })
export const stored_combat = (
  store: ControlStore,
  grant: Grant,
  fight: string,
  profiles: CombatRun['profiles'],
  now: number
) => retain(store, 'combat', { ...record(grant, now), fight, profiles })
