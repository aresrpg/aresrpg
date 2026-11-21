// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { empty_behavior_memory } from './behavior_tree.ts'
import { assert_lease, admit_command, type Command, type Lane } from './control.ts'
import { direct_waiting } from './command_admission.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore } from './store.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { command_issue } from './planning_failure.ts'
import { observed_balance } from './character_observability.ts'
import { hash_secret } from './security.ts'
import { run_hosted, run_key, ended_run } from './run_ref.ts'
import { next_behavior_action } from './behavior_plan.ts'
import type { BehaviorRun } from './behavior_script.ts'

export type RunInput = Readonly<{
  store: ControlStore
  config: BotConfig
  run: BehaviorRun
  actor_id: string
  fence: number
  context: GameplayContext
  now: number
  report_failure?: (error: unknown) => void
}>
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
/** The single signing slot is free only once the last signature settled, reconciled and was observed. */
const slot_busy = (lane: Lane, context: GameplayContext) =>
  [
    lane.pending,
    lane.active_command,
    lane.needs_resync,
    lane.reconciliation_command,
    !gameplay_observation_ready(context),
    lane.observation_revision !== context.snapshot.observation_revision,
  ].some(Boolean)
const unfunded = (previous: Command, context: GameplayContext) => {
  const balance = observed_balance(context)
  return !balance || BigInt(balance.balance_mist) <= BigInt(previous.funding_balance_mist ?? 0)
}
/** A command that did not complete is followed only once a fact it was judged on has moved: the balance
 * for an unfunded payment, otherwise the observed game state, or the clock for a refusal that spent no
 * gas. A failure that spent gas never follows the clock. */
const unmoved = (
  input: Pick<RunInput, 'config' | 'now'>,
  lane: Lane,
  previous: Command | null,
  context: GameplayContext
) => {
  if (!previous || !['failed', 'cancelled'].includes(previous.status)) return undefined
  const issue = command_issue(previous.status, previous.error)
  if (issue === 'funding_required') return unfunded(previous, context) ? issue : undefined
  const due = input.now >= (previous.refused_at ?? Infinity) + input.config.refusal_retry_ms
  return [lane.observation_revision > previous.observation_revision, due].some(Boolean) ? undefined : issue
}
/** Receipt recovery owns an uncertain envelope; once none remains, acting again is a new decision. */
const uncertain = (lane: Lane, command: Command) => ({
  status: lane.pending?.command_id === command.id ? ('waiting' as const) : ('awaiting_ai' as const),
  issue: 'command_uncertain',
})
/** Only decisions stop or pause a run. Every other gate is a fact that the next tick reads again. */
const gate = (
  input: Pick<RunInput, 'config' | 'now'>,
  lane: Lane,
  previous: Command | null,
  context: GameplayContext,
  authority: string | undefined
) => {
  const outcome = previous?.status ?? 'completed'
  if (authority) return { status: 'stopped' as const, issue: authority }
  if (lane.paused) return { status: 'paused' as const, issue: 'paused' }
  if (outcome === 'uncertain') return uncertain(lane, previous!)
  if ([slot_busy(lane, context), ['accepted', 'executing'].includes(outcome)].some(Boolean))
    return { status: 'waiting' as const, issue: 'needs_resync' }
  const issue = unmoved(input, lane, previous, context)
  return issue ? { status: 'waiting' as const, issue } : undefined
}
/** A direct command is a one-shot entry of the same queue. On its turn it takes the single signing
 * slot against fresh state, like a tree's next action; while the slot is not free it keeps waiting.
 * A pause, an owner return or a dead grant since it was accepted refuses it unsigned, and so does
 * the reason its caller found before the turn. */
export const direct_tick = async (input: Omit<RunInput, 'run'> & Readonly<{ command: Command; refusal?: string }>) => {
  const { store, config, context, now } = input
  const { id, lane_key, bot_id, grant_id } = input.command
  return store.transaction([lane_key, `command:${id}`, `bot:${bot_id}`, `grant:${grant_id}`], async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(lane_key), input.actor_id, input.fence, now)
    const command = await tx.get<Command>(`command:${id}`)
    if (!direct_waiting(lane, command)) return null
    const authority = authority_issue(
      config,
      await tx.get<Grant>(`grant:${grant_id}`),
      await tx.get<Bot>(`bot:${bot_id}`),
      now
    )
    const fenced = [lane.paused, lane.decision_revision !== command.decision_revision]
    const refusal = authority ?? (fenced.some(Boolean) ? 'bot_busy_or_paused' : input.refusal)
    if (refusal) {
      await tx.put(`command:${id}`, { ...command, status: 'failed', error: refusal })
      return null
    }
    if (slot_busy(lane, context)) return null
    const admitted: Command = { ...command, observation_revision: lane.observation_revision }
    await tx.put(`command:${id}`, admitted)
    await tx.put(lane_key, { ...lane, active_command: id, latest_command: id })
    return admitted
  })
}
export const run_observation = (run: BehaviorRun): Command => ({
  id: run_key(run.id),
  bot_id: run.bot_id,
  grant_id: run.grant_id,
  lane_key: run.lane_key,
  fingerprint: run.fingerprint,
  kind: 'observe',
  payload: { market: run.observation ?? null, prices: run.prices ?? null },
  decision_revision: 0,
  observation_revision: 0,
  status: 'accepted',
})
type Status = BehaviorRun['status']
type TickOutcome = Status | undefined | Readonly<{ status: Status; diagnostic: Error }>
const finished_result = (status: Status, diagnostic?: Error): TickOutcome =>
  diagnostic ? { status, diagnostic } : status
const report_outcome = (outcome: TickOutcome, report?: RunInput['report_failure']) => {
  if (!outcome || typeof outcome !== 'object') return outcome
  if (!report) throw outcome.diagnostic
  report(outcome.diagnostic)
  return outcome.status
}
/** A new actor lifetime evaluates the authored tree from its root, never old execution progress.
 * No receipt history means this can repeat a non-idempotent leaf after an ambiguous crash. */
const restart_run = async (input: RunInput): Promise<BehaviorRun> => {
  const requested = input.run
  const key = run_key(requested.id)
  return input.store.transaction([key, requested.lane_key], async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(requested.lane_key), input.actor_id, input.fence, input.now)
    const run = await tx.get<BehaviorRun>(key)
    if (!run) return requested
    if (run.execution_fence === lane.fence || run.revision !== requested.revision) return requested
    if (!['active', 'waiting'].includes(run.status)) return run
    const restarted: BehaviorRun = {
      ...run,
      execution_fence: lane.fence,
      memory: empty_behavior_memory(),
      pending_node: null,
      activation: null,
      consumed_command_id: null,
      observation: undefined,
      prices: undefined,
      last_command_id: null,
      actions_started: 0,
      issue: undefined,
    }
    await tx.put(key, restarted)
    return restarted
  })
}
/** Strategies select actions; this reducer admits and tracks process-local execution. */
export const run_tick = async (input: RunInput) => {
  const { store, config, context, now } = input
  const requested = await restart_run(input)
  const key = run_key(requested.id)
  const command_id = hash_secret(`${key}:fence:${input.fence}:step:${requested.actions_started}`)
  const keys = [
    key,
    requested.lane_key,
    `bot:${requested.bot_id}`,
    `grant:${requested.grant_id}`,
    `command:${command_id}`,
    ...(requested.last_command_id ? [`command:${requested.last_command_id}`] : []),
  ]
  const outcome = await store.transaction(keys, async (tx) => {
    const run = await tx.get<BehaviorRun>(key)
    if (!run) return
    if (
      ![
        ['active', 'waiting'].includes(run.status),
        run.actions_started === requested.actions_started,
        run.revision === requested.revision,
      ].every(Boolean)
    )
      return
    const lane = assert_lease(await tx.get<Lane>(run.lane_key), input.actor_id, input.fence, now)
    if (!run_hosted({ run_id: run.id }, lane)) return
    const previous = run.last_command_id ? await tx.get<Command>(`command:${run.last_command_id}`) : null
    const finish = async (status: Status, issue?: string, record: BehaviorRun = run) => {
      await tx.put(key, { ...record, status, issue })
      if (!['active', 'waiting'].includes(status))
        await tx.put(run.lane_key, { ...lane, ...ended_run(lane, run.id, { status, issue }) })
      return status
    }
    const grant = await tx.get<Grant>(`grant:${run.grant_id}`)
    const authority = authority_issue(config, grant, await tx.get<Bot>(`bot:${run.bot_id}`), now)
    const blocked = gate(input, lane, previous, context, authority)
    if (blocked) return finish(blocked.status, blocked.issue)
    const next = next_behavior_action(run, previous, context)
    if (next.state !== 'action') {
      const status = await finish(next.state, next.issue, next.record)
      // A planning fault re-evaluates every tick; it is reported when it starts, not on every pass.
      return finished_result(status, run.issue === next.issue ? undefined : next.diagnostic)
    }
    const action = next.action!
    admit_command(
      grant!,
      lane,
      { ...action, decision_revision: lane.decision_revision, observation_revision: lane.observation_revision },
      now,
      config.observation_freshness_ms
    )
    const command: Command = {
      id: command_id,
      run_id: run.id,
      behavior_binding: { revision: run.revision, node: next.record.pending_node! },
      grant_id: run.grant_id,
      bot_id: run.bot_id,
      lane_key: run.lane_key,
      fingerprint: hash_secret(JSON.stringify([run.id, run.actions_started, action])),
      ...action,
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
      status: 'accepted',
    }
    await tx.put(`command:${command.id}`, command)
    await tx.put(run.lane_key, {
      ...lane,
      active_command: command.id,
      latest_command: command.id,
      run_commands: { ...lane.run_commands, [key]: command.id },
    })
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
