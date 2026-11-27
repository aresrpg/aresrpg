// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { empty_behavior_memory } from './behavior_tree.ts'
import { assert_lease, admit_command, type Command, type Lane } from './control.ts'
import { direct_waiting } from './command_admission.ts'
import { authority_fault, authorize, CONTROL_SCOPES, hash_secret, type BotConfig } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { command_issue } from './planning_failure.ts'
import { observed_balance } from './character_observability.ts'
import { run_hosted, run_key, ended_run, run_keys } from './run_ref.ts'
import { next_behavior_action, retain_behavior_draft } from './behavior_plan.ts'
import type { BehaviorRun } from './behavior_script.ts'
import type { Journey } from './idle.ts'
import { assert_run_admission } from './behavior_control.ts'
import type { JournalBinding } from './transaction_lifecycle.ts'

type RunInput = Readonly<{
  store: ControlStore
  config: BotConfig
  run: BehaviorRun
  actor_id: string
  fence: number
  context: GameplayContext
  /** Tells the wallet's background walk where this run sends its hero, or that it sends it nowhere. */
  journey?: (character_id: string, journey: Journey | null) => void
  now: number
  report_failure?: (error: unknown) => void
}>
/** The run's or command's grant, or the reason it no longer acts. */
const authority = (input: Pick<RunInput, 'config' | 'now'>, read: ControlTransaction['get'], grant: GrantRef) =>
  authorize(read, input.config, grant, CONTROL_SCOPES.accept, input.now).then(
    (live) => ({ grant: live.grant, issue: undefined }),
    (error: unknown) => ({ grant: undefined, issue: authority_fault(error) })
  )
type GrantRef = Parameters<typeof authorize>[2]
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
  const { store, context, now } = input
  const { id, lane_key, bot_id, grant_id } = input.command
  return store.transaction([lane_key, `command:${id}`, `bot:${bot_id}`, `grant:${grant_id}`], async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(lane_key), input.actor_id, input.fence, now)
    const command = await tx.get<Command>(`command:${id}`)
    if (!direct_waiting(lane, command)) return null
    const { issue } = await authority(input, tx.get, { id: grant_id, bot_id, address: lane.address })
    const fenced = [lane.paused, lane.decision_revision !== command.decision_revision]
    const refusal = issue ?? (fenced.some(Boolean) ? 'bot_busy_or_paused' : input.refusal)
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
    const { grant, issue } = await authority(input, tx.get, {
      id: run.grant_id,
      bot_id: run.bot_id,
      address: lane.address,
    })
    const blocked = gate(input, lane, previous, context, issue)
    if (blocked) return finish(blocked.status, blocked.issue)
    const next = next_behavior_action(run, previous, context)
    input.journey?.(run.character_id, next.journey ?? null)
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
/** Refresh only accepted drafts that have never crossed preparation; signed bytes are never replanned
 * here. A run's draft is chosen again from its immutable tree. A direct command keeps its typed
 * payload and only binds to the observation it is about to be validated against. */
export const refresh_run_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
): Promise<Command | null> => {
  const { command, actor_id, fence } = binding
  const result = await store.transaction(
    [
      ...run_keys(command),
      command.lane_key,
      `command:${command.id}`,
      `grant:${command.grant_id}`,
      `bot:${command.bot_id}`,
    ],
    async (tx) => {
      const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
      const current = await tx.get<Command>(`command:${command.id}`)
      if (!current) throw new Error('execution_not_authorized')
      await authorize(
        tx.get,
        config,
        { id: command.grant_id, bot_id: command.bot_id, address: lane.address },
        CONTROL_SCOPES.accept,
        now
      )
      const valid = [
        current.status === 'accepted',
        current.fingerprint === command.fingerprint,
        !lane.pending,
        !lane.paused,
        !lane.needs_resync,
        !lane.reconciliation_command,
        lane.active_command === command.id,
        lane.decision_revision === command.decision_revision,
        lane.observation_revision === context.snapshot.observation_revision,
      ].every(Boolean)
      if (!valid) throw new Error('execution_not_authorized')
      await assert_run_admission(tx, current, lane)
      if (!gameplay_observation_ready(context)) return null
      const fresh: Command = { ...current, observation_revision: lane.observation_revision }
      if (current.run_id)
        return retain_behavior_draft(tx, (await tx.get<BehaviorRun>(run_key(current.run_id)))!, current, lane, {
          ...context,
          command: fresh,
        })
      await tx.put(`command:${current.id}`, fresh)
      return fresh
    }
  )
  if (result instanceof Error) throw result
  return result
}

/** A stale prepare refusal is still an accepted intent, not a failed or uncertain transaction:
 * a run's draft and a direct command alike keep the slot and bind to the next observation. */
export const stale_run_draft = (command: Command, lane: Lane, error: unknown): boolean =>
  [
    command.status === 'accepted',
    !lane.pending,
    !lane.paused,
    run_hosted(command, lane),
    lane.active_command === command.id,
    lane.decision_revision === command.decision_revision,
    lane.observation_revision !== command.observation_revision,
    error instanceof Error && ['needs_resync', 'execution_not_authorized'].includes(error.message),
  ].every(Boolean)
/** Retain an accepted intent, never an execution retry. The existing scheduler samples the
 * server-pushed freeze state; the ordinary gameplay and SDK gates revalidate on release. */
export const wait_for_contract = async (
  store: ControlStore,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
): Promise<Command | null> => {
  const { command, actor_id, fence } = binding
  const { snapshot } = context
  if (!command.waiting_for_resume && snapshot.ready) return command
  const keys = [command.lane_key, `command:${command.id}`, ...run_keys(command)]
  return store.transaction(keys, async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
    const current = await tx.get<Command>(`command:${command.id}`)
    const valid = [
      current?.status === 'accepted',
      current?.fingerprint === command.fingerprint,
      lane.active_command === command.id,
      lane.decision_revision === command.decision_revision,
      !lane.paused,
      !lane.pending,
    ].every(Boolean)
    if (!valid) throw new Error('execution_not_authorized')
    await assert_run_admission(tx, command, lane)
    if (!gameplay_observation_ready(context)) {
      if (!current!.waiting_for_resume) await tx.put(`command:${command.id}`, { ...current!, waiting_for_resume: true })
      return null
    }
    const next = { ...current!, waiting_for_resume: false, observation_revision: snapshot.observation_revision }
    await tx.put(`command:${command.id}`, next)
    return next
  })
}

export const ready_gameplay_command = async (
  store: ControlStore,
  config: BotConfig,
  binding: JournalBinding,
  context: GameplayContext,
  now: number
) => {
  const command = await wait_for_contract(store, binding, context, now)
  return command ? refresh_run_command(store, config, { ...binding, command }, context, now) : null
}
/** What a command that threw before its receipt becomes: still an intent when only its observation went
 * stale, uncertain when an envelope or a later phase may have executed, failed otherwise. */
export const record_command_failure = (
  store: ControlStore,
  { command, actor_id, fence }: JournalBinding,
  error: unknown,
  funding_balance_mist: string | undefined,
  now: number
) =>
  store.transaction([command.lane_key, `command:${command.id}`], async (tx) => {
    const lane = assert_lease(await tx.get<Lane>(command.lane_key), actor_id, fence, now)
    const current = await tx.get<Command>(`command:${command.id}`)
    if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) return
    if (stale_run_draft(current, lane, error)) return
    // A prepared command whose envelope is gone may still have executed.
    const unknown = [lane.pending, current.status !== 'accepted'].some(Boolean)
    await tx.put(`command:${command.id}`, {
      ...current,
      status: unknown ? 'uncertain' : 'failed',
      error: String(error),
      ...(funding_balance_mist ? { funding_balance_mist } : {}),
      ...(unknown ? {} : { refused_at: now }),
    })
    await tx.put(command.lane_key, {
      ...lane,
      needs_resync: true,
      active_command: lane.pending ? lane.active_command : null,
    })
  })
