// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { assert_lease, admit_command, type Command, type Lane } from './control.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore } from './store.ts'
import type { CombatRun } from './combat_control.ts'
import { next_combat_action } from './combat_plan.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { hash_secret } from './security.ts'

export const combat_observation = (run: CombatRun): Command => ({
  id: `combat:${run.id}`,
  bot_id: run.bot_id,
  grant_id: run.grant_id,
  lane_key: run.lane_key,
  fingerprint: run.fingerprint,
  kind: 'observe',
  payload: {},
  decision_revision: 0,
  observation_revision: 0,
  status: 'accepted',
})

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

const combat_gate = (
  lane: Lane,
  previous: Command | null,
  context: GameplayContext,
  issue: string | undefined
): Readonly<{ status: CombatRun['status']; issue?: string }> | undefined => {
  if (issue) return { status: 'stopped', issue }
  if (lane.paused || lane.transport_stopped) return { status: 'paused', issue: 'paused' }
  if (previous && ['failed', 'uncertain', 'cancelled'].includes(previous.status))
    return { status: 'failed', issue: previous.error }
  const waiting = [
    lane.pending,
    lane.active_command,
    lane.needs_resync,
    lane.reconciliation_command,
    previous && previous.status !== 'completed',
    !gameplay_observation_ready(context),
    lane.observation_revision !== context.snapshot.observation_revision,
  ].some(Boolean)
  return waiting ? { status: 'waiting' } : undefined
}
const plan_result = (run: CombatRun, context: GameplayContext) => {
  try {
    return { ok: true as const, next: next_combat_action(run, context) }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

const combat_decision = (run: CombatRun, previous: Command | null, context: GameplayContext) => {
  const result = plan_result(run, context)
  if (!result.ok) return { state: 'awaiting_ai' as const, issue: result.error }
  const { next } = result
  if (next.state === 'completed' && previous?.kind !== 'fight_settle')
    return { state: 'awaiting_ai' as const, issue: 'custody_changed' }
  return next
}

export const combat_tick = async (
  input: Readonly<{
    store: ControlStore
    config: BotConfig
    run: CombatRun
    actor_id: string
    fence: number
    context: GameplayContext
    now: number
  }>
) => {
  const { store, config, run: requested, context, now } = input
  const key = `combat:${requested.id}`
  const command_id = hash_secret(`${key}:step:${requested.actions_started}`)
  const keys = [
    key,
    requested.lane_key,
    `bot:${requested.bot_id}`,
    `grant:${requested.grant_id}`,
    `command:${command_id}`,
    ...(requested.last_command_id ? [`command:${requested.last_command_id}`] : []),
  ]
  return store.transaction(keys, async (tx) => {
    const run = await tx.get<CombatRun>(key)
    if (!run || !['active', 'waiting'].includes(run.status) || run.actions_started !== requested.actions_started) return
    const lane = assert_lease(await tx.get<Lane>(run.lane_key), input.actor_id, input.fence, now)
    if (lane.combat_run_id !== run.id) return
    const previous = run.last_command_id ? await tx.get<Command>(`command:${run.last_command_id}`) : null
    const finish = async (status: CombatRun['status'], issue?: string) => {
      if (run.status !== status || run.issue !== issue) await tx.put(key, { ...run, status, issue })
      if (!['active', 'waiting'].includes(status)) await tx.put(run.lane_key, { ...lane, combat_run_id: null })
      return status
    }
    const grant = await tx.get<Grant>(`grant:${run.grant_id}`)
    const issue = authority_issue(config, grant, await tx.get<Bot>(`bot:${run.bot_id}`), now)
    const gate = combat_gate(lane, previous, context, issue)
    if (gate) return finish(gate.status, gate.issue)
    const next = combat_decision(run, previous, context)
    if (next.state !== 'action') return finish(next.state, next.issue)
    const action = next.action!
    admit_command(
      grant!,
      { ...lane, combat_run_id: null },
      {
        ...action,
        decision_revision: lane.decision_revision,
        observation_revision: lane.observation_revision,
      },
      now,
      config.observation_freshness_ms
    )
    const command: Command = {
      id: command_id,
      combat_run_id: run.id,
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
      ...run,
      status: 'active',
      actions_started: run.actions_started + 1,
      last_command_id: command.id,
      issue: undefined,
    })
    return 'active' as const
  })
}
