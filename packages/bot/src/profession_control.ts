// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore } from './store.ts'
import { lane_busy } from './command_admission.ts'
import type { Command, Lane } from './control.ts'
import type { ProfessionBaseline } from './action_receipts.ts'
import { profession_bounds, type ProfessionPlan, type ProfessionNext, type PlanIssue } from './profession_plan.ts'

export type ProfessionRun = Readonly<{
  id: string
  bot_id: string
  grant_id: string
  lane_key: string
  fingerprint: string
  plan: ProfessionPlan
  status: 'active' | 'waiting' | 'awaiting_ai' | 'paused' | 'completed' | 'stopped' | 'failed'
  actions_started: number
  last_command_id: string | null
  last_observation?: ProfessionBaseline
  created_at: number
  progress?: ProfessionNext['progress']
  issue?: PlanIssue
}>
const owned_record = <T extends Readonly<{ grant_id: string; bot_id: string }>>(
  record: T | null,
  grant: Pick<Grant, 'id' | 'bot_id'>
): record is T => !!record && [record.grant_id === grant.id, record.bot_id === grant.bot_id].every(Boolean)
export const create_profession_control = (store: ControlStore, config: BotConfig, now: () => number) => {
  const profession_status = async (grant: Grant, id: string) => {
    const run = await store.read<ProfessionRun>(`profession:${id}`)
    if (!owned_record(run, grant)) throw new Error('profession_run_not_found')
    return { ...run, command: run.last_command_id ? await store.read<Command>(`command:${run.last_command_id}`) : null }
  }
  const resume_profession = async (
    grant: Grant,
    id: string,
    decision_revision: number,
    observation_revision: number
  ) => {
    const previous = await profession_status(grant, id)
    return store.transaction(
      [`profession:${id}`, previous.lane_key, `grant:${grant.id}`, `bot:${grant.bot_id}`],
      async (tx) => {
        const current = await tx.get<Grant>(`grant:${grant.id}`)
        if (!current) throw new Error('invalid_token')
        assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
        if (!current.scopes.includes('bot:play')) throw new Error('insufficient_scope')
        const run = await tx.get<ProfessionRun>(`profession:${id}`)
        if (!owned_record(run, current)) throw new Error('profession_run_not_found')
        if (!['awaiting_ai', 'paused'].includes(run.status)) throw new Error('profession_not_resumable')
        if (
          profession_bounds(run.plan).deadline_ms <= now() ||
          run.actions_started >= profession_bounds(run.plan).max_actions
        )
          throw new Error('profession_limit_reached')
        const lane = await tx.get<Lane>(run.lane_key)
        assert_run_start(lane, { decision_revision, observation_revision }, now(), config.observation_freshness_ms)
        await tx.put(`profession:${id}`, { ...run, status: 'active', issue: undefined })
        await tx.put(run.lane_key, { ...lane!, profession_run_id: id, decision_revision: lane!.decision_revision + 1 })
        return { resumed: true, run_id: id }
      }
    )
  }
  return { profession_status, resume_profession }
}
const assert_run_start = (
  lane: Lane | null,
  input: Readonly<{ decision_revision: number; observation_revision: number }>,
  now: number,
  freshness_ms: number
) => {
  if (!lane) throw new Error('needs_resync')
  if (lane_busy(lane)) throw new Error('bot_busy_or_paused')
  if (
    [
      lane.needs_resync,
      lane.lease_until <= now,
      lane.observed_at + freshness_ms <= now,
      lane.decision_revision !== input.decision_revision,
      lane.observation_revision !== input.observation_revision,
    ].some(Boolean)
  )
    throw new Error('needs_resync')
}
