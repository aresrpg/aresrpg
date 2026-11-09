// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore } from './store.ts'
import type { Command, Lane, Observe } from './control.ts'
import { hash_secret } from './security.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import {
  profession_plan_errors,
  validate_profession_plan,
  type ProfessionPlan,
  type ProfessionNext,
  type PlanIssue,
} from './profession_plan.ts'

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
  last_observation?: Readonly<{
    job: string
    xp: string
    checkpoint_ms: number
    zone?: Readonly<{ key: string; seed: string; pack_index: number; nodes: number }>
  }>
  created_at: number
  progress?: ProfessionNext['progress']
  issue?: PlanIssue
}>
type StartProfessionResult =
  | Readonly<{ accepted: true; run: ProfessionRun }>
  | Readonly<{ accepted: false; validation: ReturnType<typeof validate_profession_plan> }>
const owned_record = <T extends Readonly<{ grant_id: string; bot_id: string }>>(
  record: T | null,
  grant: Grant
): record is T => !!record && [record.grant_id === grant.id, record.bot_id === grant.bot_id].every(Boolean)
export const create_profession_control = (
  store: ControlStore,
  config: BotConfig,
  now: () => number,
  observe: Observe
) => {
  const profession_status = async (grant: Grant, id: string) => {
    const run = await store.read<ProfessionRun>(`profession:${id}`)
    if (!owned_record(run, grant)) throw new Error('profession_run_not_found')
    return { ...run, command: run.last_command_id ? await store.read<Command>(`command:${run.last_command_id}`) : null }
  }
  const validate_plan = async (grant: Grant, value: unknown) => {
    const live = (await observe(grant, {})) as ActorSnapshot & {
      status?: string
      decision_revision: number
      sampled_at: number
    }
    if (live.status === 'pending') return validate_profession_plan(value, now())
    const command: Command = {
      id: '',
      grant_id: grant.id,
      bot_id: grant.bot_id,
      lane_key: `lane:${grant.network}:${grant.address}`,
      fingerprint: '',
      kind: 'observe',
      payload: {},
      decision_revision: live.decision_revision,
      observation_revision: live.observation_revision,
      status: 'completed',
    }
    return validate_profession_plan(value, now(), {
      address: grant.address,
      snapshot: live,
      command,
      now: live.sampled_at,
      freshness_ms: config.observation_freshness_ms,
    })
  }
  const start_profession = async (
    grant: Grant,
    input: Readonly<{ idempotency_key: string; plan: unknown; decision_revision: number; observation_revision: number }>
  ): Promise<StartProfessionResult> => {
    const errors = profession_plan_errors(input.plan, 0)
    if (errors.length) return { accepted: false, validation: validate_profession_plan(input.plan, now()) }
    const plan = input.plan as ProfessionPlan
    const id = hash_secret(`${grant.id}:profession:${input.idempotency_key}`)
    const lane_key = `lane:${grant.network}:${grant.address}`
    const fingerprint = hash_secret(JSON.stringify(input))
    return store.transaction<StartProfessionResult>(
      [`profession:${id}`, lane_key, `grant:${grant.id}`, `bot:${grant.bot_id}`],
      async (tx) => {
        const current = await tx.get<Grant>(`grant:${grant.id}`)
        if (!current) throw new Error('invalid_token')
        assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
        if (!current.scopes.includes('bot:play')) throw new Error('insufficient_scope')
        const prior = await tx.get<ProfessionRun>(`profession:${id}`)
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new Error('idempotency_conflict')
          return { accepted: true, run: prior }
        }
        if (plan.deadline_ms <= now()) return { accepted: false, validation: validate_profession_plan(plan, now()) }
        const lane = await tx.get<Lane>(lane_key)
        assert_run_start(lane, input, now(), config.observation_freshness_ms)
        const run: ProfessionRun = {
          id,
          bot_id: grant.bot_id,
          grant_id: grant.id,
          lane_key,
          fingerprint,
          plan,
          status: 'active',
          actions_started: 0,
          last_command_id: null,
          created_at: now(),
        }
        await tx.put(`profession:${id}`, run)
        await tx.put(lane_key, { ...lane!, profession_run_id: id, decision_revision: lane!.decision_revision + 1 })
        return { accepted: true, run }
      }
    )
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
        if (run.plan.deadline_ms <= now() || run.actions_started >= run.plan.max_actions)
          throw new Error('profession_limit_reached')
        const lane = await tx.get<Lane>(run.lane_key)
        assert_run_start(lane, { decision_revision, observation_revision }, now(), config.observation_freshness_ms)
        await tx.put(`profession:${id}`, { ...run, status: 'active', issue: undefined })
        await tx.put(run.lane_key, { ...lane!, profession_run_id: id, decision_revision: lane!.decision_revision + 1 })
        return { resumed: true, run_id: id }
      }
    )
  }
  return { validate_plan, start_profession, profession_status, resume_profession }
}
const assert_run_start = (
  lane: Lane | null,
  input: Readonly<{ decision_revision: number; observation_revision: number }>,
  now: number,
  freshness_ms: number
) => {
  if (!lane) throw new Error('needs_resync')
  if ([lane.paused, lane.pending, lane.active_command, lane.profession_run_id].some(Boolean))
    throw new Error('bot_busy_or_paused')
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
