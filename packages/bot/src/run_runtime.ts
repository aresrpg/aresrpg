// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Receipt } from '@aresrpg/sdk/cache'

import { assert_lease, admit_command, type Command, type Lane } from './control.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import { plan_issue, type PlanIssue } from './profession_plan.ts'
import { receipt_projected } from './action_receipts.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { command_issue } from './planning_failure.ts'
import { hash_secret } from './security.ts'
import { run_ref_of, run_binding, cleared_run, type RunKind } from './run_ref.ts'
import { run_decision, run_bounds, run_revision, behavior_binding, type Run } from './run_plan.ts'

export type RunInput = Readonly<{
  store: ControlStore
  config: BotConfig
  run: Run
  actor_id: string
  fence: number
  context: GameplayContext
  now: number
  report_failure?: (error: unknown) => void
}>
const issue_for = (kind: RunKind, code: string): string | PlanIssue =>
  kind !== 'profession'
    ? code
    : plan_issue(code, 'run', code, 'Inspect the run and command before explicitly resuming or replacing its intent.')
const authority_issue = (config: BotConfig, grant: Grant | null, bot: Bot | null, now: number) => {
  try {
    if (!grant) throw new Error('invalid_token')
    assert_live_grant(config, grant, bot, now)
    if (!grant.scopes.includes('bot:play')) throw new Error('insufficient_scope')
    return undefined
  } catch (error) {
    if (error instanceof Error && ['invalid_token', 'insufficient_scope'].includes(error.message)) return error.message
    throw error
  }
}
const gate = (
  run: Run,
  lane: Lane,
  previous: Command | null,
  context: GameplayContext,
  authority: string | undefined,
  now: number
) => {
  if (authority) return { status: 'stopped' as const, issue: authority }
  if ([lane.paused, lane.transport_stopped].some(Boolean)) return { status: 'paused' as const, issue: 'paused' }
  if (run_bounds(run).deadline_ms <= now) return { status: 'stopped' as const, issue: 'deadline_expired' }
  const outcome = previous ?? { status: 'completed', error: 'step_failed' }
  if (['failed', 'uncertain', 'cancelled'].includes(outcome.status))
    return 'script' in run
      ? { status: 'awaiting_ai' as const, issue: command_issue(outcome.status, outcome.error) }
      : { status: 'failed' as const, issue: String(outcome.error) }
  return [
    lane.pending,
    lane.active_command,
    lane.needs_resync,
    lane.reconciliation_command,
    outcome.status !== 'completed',
    !gameplay_observation_ready(context),
    lane.observation_revision !== context.snapshot.observation_revision,
  ].some(Boolean)
    ? { status: 'waiting' as const, issue: 'needs_resync' }
    : undefined
}
/** Historical profession records may hold the only baseline for their already accepted command.
 * Read it only for that exact command; never reconstruct submitted evidence from current state. */
const projected_lane = async (
  tx: ControlTransaction,
  run: Run,
  lane: Lane,
  previous: Command | null,
  digest: string | undefined,
  context: GameplayContext
): Promise<Lane> => {
  if (!('plan' in run) || !previous) return lane
  const waiting = { ...lane, needs_resync: true }
  if (!digest || !run.last_observation || !context.snapshot.ready) return waiting
  const record = await tx.get<{ receipt: Receipt }>(`receipt:${digest}`)
  return record && receipt_projected(run.last_observation, previous, record.receipt, context)
    ? { ...lane, needs_resync: false, reconciliation_command: null }
    : waiting
}
export const run_observation = (kind: RunKind, run: Run): Command => ({
  id: `${kind}:${run.id}`,
  bot_id: run.bot_id,
  grant_id: run.grant_id,
  lane_key: run.lane_key,
  fingerprint: run.fingerprint,
  kind: 'observe',
  payload: 'script' in run ? { market: run.observation ?? null, prices: run.prices ?? null } : {},
  decision_revision: 0,
  observation_revision: 0,
  status: 'accepted',
})
type TickOutcome = Run['status'] | undefined | Readonly<{ status: Run['status']; diagnostic: Error }>
const finished_result = (status: Run['status'], diagnostic?: Error): TickOutcome =>
  diagnostic ? { status, diagnostic } : status
const report_outcome = (outcome: TickOutcome, report?: RunInput['report_failure']) => {
  if (!outcome || typeof outcome !== 'object') return outcome
  if (!report) throw outcome.diagnostic
  report(outcome.diagnostic)
  return outcome.status
}
// Behavior blockers retain their discoverable objective; legacy blockers release the lane
// for their existing corrective-command and explicit-resume contract.
const released_run = (run: Run, status: Run['status']) =>
  'script' in run && status === 'awaiting_ai' ? {} : cleared_run
/** The only durable run reducer: strategies select actions; this owner admits and tracks them. */
export const run_tick = async (kind: RunKind, input: RunInput) => {
  const { store, config, run: requested, context, now } = input
  const key = `${kind}:${requested.id}`
  // Keep historical command IDs and envelope identities unchanged across this reducer migration.
  const command_id = hash_secret(`${kind === 'combat' ? key : requested.id}:step:${requested.actions_started}`)
  const prior = requested.last_command_id ? await store.read<Command>(`command:${requested.last_command_id}`) : null
  const digest = (prior?.result as { digest?: string } | undefined)?.digest
  const keys = [
    key,
    requested.lane_key,
    `bot:${requested.bot_id}`,
    `grant:${requested.grant_id}`,
    `command:${command_id}`,
    ...(digest ? [`receipt:${digest}`] : []),
    ...(requested.last_command_id ? [`command:${requested.last_command_id}`] : []),
  ]
  const outcome = await store.transaction(keys, async (tx) => {
    const run = await tx.get<Run>(key)
    if (!run) return
    if (
      ![
        ['active', 'waiting'].includes(run.status),
        run.actions_started === requested.actions_started,
        run_revision(run) === run_revision(requested),
      ].every(Boolean)
    )
      return
    const retained = assert_lease(await tx.get<Lane>(run.lane_key), input.actor_id, input.fence, now)
    const reference = run_ref_of(retained)
    if (JSON.stringify(reference) !== JSON.stringify({ kind, id: run.id })) return
    const previous = run.last_command_id ? await tx.get<Command>(`command:${run.last_command_id}`) : null
    const lane = await projected_lane(tx, run, retained, previous, digest, context)
    const finish = async (status: Run['status'], issue?: string | PlanIssue, record: Run = run) => {
      await tx.put(key, { ...record, status, issue })
      if (!['active', 'waiting'].includes(status))
        await tx.put(run.lane_key, {
          ...lane,
          ...released_run(run, status),
          decision_revision: lane.decision_revision + 1,
        })
      return status
    }
    const grant = await tx.get<Grant>(`grant:${run.grant_id}`)
    const authority = authority_issue(config, grant, await tx.get<Bot>(`bot:${run.bot_id}`), now)
    const blocked = gate(run, lane, previous, context, authority, now)
    if (blocked) return finish(blocked.status, issue_for(kind, blocked.issue))
    const next = run_decision(run, previous, context)
    if (next.state !== 'action') {
      const status = await finish(next.state, next.issue, next.record)
      return finished_result(status, next.diagnostic)
    }
    if (run.actions_started >= run_bounds(run).max_actions)
      return finish('stopped', issue_for(kind, 'action_limit_reached'), next.record)
    const action = next.action!
    admit_command(
      grant!,
      { ...lane, ...cleared_run },
      { ...action, decision_revision: lane.decision_revision, observation_revision: lane.observation_revision },
      now,
      config.observation_freshness_ms
    )
    const command: Command = {
      id: command_id,
      ...run_binding(kind, run.id),
      ...behavior_binding(next.record),
      grant_id: run.grant_id,
      bot_id: run.bot_id,
      lane_key: run.lane_key,
      fingerprint: hash_secret(JSON.stringify([run.id, run.actions_started, action])),
      ...action,
      decision_revision: lane.decision_revision + 1,
      observation_revision: lane.observation_revision,
      status: 'accepted',
    }
    await tx.put(`command:${command.id}`, command)
    await tx.put(run.lane_key, { ...lane, active_command: command.id, decision_revision: command.decision_revision })
    await tx.put(key, {
      ...next.record,
      status: 'active',
      actions_started: run.actions_started + 1,
      last_command_id: command.id,
      issue: undefined,
    })
    return 'active' as const
  })
  return report_outcome(outcome, input.report_failure)
}
