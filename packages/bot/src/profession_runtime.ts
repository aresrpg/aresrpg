// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { gatherable_of } from '@aresrpg/immutable'
import { live_resource_packs } from '@aresrpg/protocol'
import { receipt_digest, receipt_event, type Receipt } from '@aresrpg/sdk/cache'

import { inventory_projected } from './actor_inventory.ts'
import { assert_lease, admit_command, type Command, type Lane } from './control.ts'
import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import type { ProfessionRun } from './profession_control.ts'
import { next_profession_action, plan_issue, type PlanIssue } from './profession_plan.ts'
import type { GameplayContext } from './gameplay_context.ts'
import { hash_secret } from './security.ts'
import { recipe_job } from './profession_catalog.ts'
import { zone_key } from './actor_world.ts'

export const profession_tick = async (
  input: Readonly<{
    store: ControlStore
    config: BotConfig
    run: ProfessionRun
    actor_id: string
    fence: number
    context: GameplayContext
    now: number
  }>
) => {
  const { store, config, run: requested, context, now } = input
  const command_id = hash_secret(`${requested.id}:step:${requested.actions_started}`)
  const previous = requested.last_command_id ? await store.read<Command>(`command:${requested.last_command_id}`) : null
  const digest = (previous?.result as { digest?: string } | undefined)?.digest
  const keys = [
    `profession:${requested.id}`,
    requested.lane_key,
    `bot:${requested.bot_id}`,
    `grant:${requested.grant_id}`,
    `command:${command_id}`,
    ...(digest ? [`receipt:${digest}`] : []),
    ...(requested.last_command_id ? [`command:${requested.last_command_id}`] : []),
  ]
  return store.transaction(keys, async (tx) => {
    const run = await tx.get<ProfessionRun>(`profession:${requested.id}`)
    if (!run) return
    if (![['active', 'waiting'].includes(run.status), run.actions_started === requested.actions_started].every(Boolean))
      return
    const retained_lane = assert_lease(await tx.get<Lane>(run.lane_key), input.actor_id, input.fence, now)
    if (retained_lane.profession_run_id !== run.id) return
    const previous = run.last_command_id ? await tx.get<Command>(`command:${run.last_command_id}`) : null
    const projected = await step_projected(tx, digest, run, previous, context)
    const lane = projection_lane(retained_lane, previous, projected, context)
    const finish = async (status: ProfessionRun['status'], issue?: PlanIssue, progress = run.progress) => {
      await tx.put(`profession:${run.id}`, { ...run, status, issue, progress })
      if (!['active', 'waiting'].includes(status)) await tx.put(run.lane_key, { ...lane, profession_run_id: null })
      return status
    }
    const grant = await tx.get<Grant>(`grant:${run.grant_id}`)
    const authority = profession_authority(config, grant, await tx.get<Bot>(`bot:${run.bot_id}`), now)
    const gate = profession_gate(run, lane, previous, authority, context, now, projected)
    if (gate) {
      return finish(gate.status, gate.issue)
    }
    const next = next_profession_action(run.plan, context)
    if (next.state !== 'action') {
      return finish(next.state, next.issue, next.progress)
    }
    if (run.actions_started >= run.plan.max_actions) {
      return finish(
        'stopped',
        plan_issue(
          'action_limit_reached',
          'max_actions',
          'The caller action limit was reached.',
          'Review actual XP and submit a new bounded plan if desired.'
        ),
        next.progress
      )
    }
    const action = next.action!
    // The same admission gate owns all gameplay; only this exact run may occupy its lane.
    admit_command(
      grant!,
      { ...lane, profession_run_id: null },
      {
        ...action,
        decision_revision: lane.decision_revision,
        observation_revision: context.snapshot.observation_revision,
      },
      now,
      config.observation_freshness_ms
    )
    const command: Command = {
      id: command_id,
      profession_run_id: run.id,
      grant_id: run.grant_id,
      bot_id: run.bot_id,
      lane_key: run.lane_key,
      fingerprint: hash_secret(JSON.stringify([run.id, run.actions_started, action])),
      kind: action.kind,
      payload: action.payload,
      decision_revision: lane.decision_revision + 1,
      observation_revision: lane.observation_revision,
      status: 'accepted',
    }
    await tx.put(`command:${command.id}`, command)
    await tx.put(run.lane_key, { ...lane, active_command: command.id, decision_revision: command.decision_revision })
    await tx.put(`profession:${run.id}`, {
      ...run,
      status: 'active',
      actions_started: run.actions_started + 1,
      last_command_id: command.id,
      last_observation: step_observation(action, context),
      progress: next.progress,
      issue: undefined,
    })
    return 'active' as const
  })
}

const profession_authority = (config: BotConfig, grant: Grant | null, bot: Bot | null, now: number) => {
  try {
    if (!grant) throw new Error('invalid_token')
    assert_live_grant(config, grant, bot, now)
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      error: plan_issue(
        'invalid_token',
        'grant',
        String(error),
        'Reconnect with current owner approval; no further action is admitted.'
      ),
    }
  }
}
const profession_gate = (
  run: ProfessionRun,
  lane: Lane,
  previous: Command | null,
  authority: ReturnType<typeof profession_authority>,
  context: GameplayContext,
  now: number,
  projected: boolean
) => {
  const gates: readonly Readonly<{ when: boolean; status: ProfessionRun['status']; issue?: PlanIssue }>[] = [
    { when: !authority.ok, status: 'stopped', issue: authority.ok ? undefined : authority.error },
    {
      when: lane.paused,
      status: 'paused',
      issue: plan_issue(
        'paused',
        'run',
        'Gameplay was paused.',
        'Resolve pending transactions, resume the bot, then explicitly resume this run.'
      ),
    },
    {
      when: run.plan.deadline_ms <= now,
      status: 'stopped',
      issue: plan_issue(
        'deadline_expired',
        'deadline_ms',
        'The caller deadline was reached.',
        'Review observed progress and submit a new bounded plan if desired.'
      ),
    },
    {
      when: ['failed', 'uncertain', 'cancelled'].includes(String(previous?.status)),
      status: 'failed',
      issue: plan_issue(
        'step_failed',
        'last_command_id',
        String(previous?.error),
        'Inspect the exact command and reconcile any pending envelope. No automatic replacement or retry.'
      ),
    },
    {
      when: [
        lane.pending,
        lane.active_command,
        previous ? previous.status !== 'completed' : false,
        lane.needs_resync,
        !context.snapshot.ready,
        !projected,
        context.snapshot.observation_revision !== lane.observation_revision,
      ].some(Boolean),
      status: 'waiting',
      issue: plan_issue(
        'needs_resync',
        'live',
        'Waiting for the previous command and a fresh projection.',
        'Observe the exact command; uncertain work cannot be replaced.'
      ),
    },
  ]
  return gates.find(({ when }) => when)
}
export const profession_observation = (run: ProfessionRun): Command => ({
  id: `profession:${run.id}`,
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

/** The baseline belongs to the accepted step, not to packet arrival or a heartbeat. */
export const step_observation = (
  action: Readonly<{ kind: string; payload: Readonly<Record<string, unknown>> }>,
  context: GameplayContext
): NonNullable<ProfessionRun['last_observation']> => {
  const character = context.snapshot.characters.find(({ id }) => id === action.payload.character_id)!
  const job =
    action.kind === 'craft'
      ? recipe_job(String(action.payload.output_type))!
      : gatherable_of(String(action.payload.item_type))!.job
  const base = { job, xp: character.jobs[job] ?? '0', checkpoint_ms: character.at_ms ?? 0 }
  if (action.kind === 'craft') return base
  const key = zone_key(String(action.payload.world), Number(action.payload.zone_x), Number(action.payload.zone_z))
  const row = context.snapshot.zones[key]!
  const pack_index = Number(action.payload.pack_index)
  const pack = live_resource_packs(row.spawns!.resources, row.zone).find(({ index }) => index === pack_index)!
  return { ...base, zone: { key, seed: row.zone.seed, pack_index, nodes: pack.nodes } }
}
const gather_projected = (before: NonNullable<ProfessionRun['last_observation']>, context: GameplayContext) => {
  const { zone: target } = before
  if (!target) return true
  const row = context.snapshot.zones[target.key]
  if (!row?.spawns) return false
  const pack = live_resource_packs(row.spawns.resources, row.zone).find(({ index }) => index === target.pack_index)
  return row.zone.seed !== target.seed || (pack?.nodes ?? 0) < target.nodes
}
const step_projected = async (
  tx: ControlTransaction,
  digest: string | undefined,
  run: ProfessionRun,
  previous: Command | null,
  context: GameplayContext
) => {
  if (!previous) return true
  if (!digest) return false
  const record = await tx.get<{ receipt: Receipt }>(`receipt:${digest}`)
  if (!record || !run.last_observation) return false
  return receipt_projected(run.last_observation, previous, record.receipt, context)
}
export const receipt_projected = (
  before: NonNullable<ProfessionRun['last_observation']>,
  previous: Command,
  receipt: Receipt,
  context: GameplayContext
) => {
  const expected_digest = (previous.result as { digest?: string }).digest
  if ([previous.status !== 'completed', receipt_digest(receipt) !== expected_digest].some(Boolean)) return false
  const event = receipt_event(
    receipt,
    previous.kind === 'craft' ? '::crafting::Crafted' : '::gathering::ResourceGathered'
  )
  const character = context.snapshot.characters.find(({ id }) => id === previous.payload.character_id)
  if (!character || !event) return false
  const gained = String(event.job_xp_gained)
  if (!/^\d+$/.test(gained)) return false
  const xp_ready = BigInt(character.jobs[before.job] ?? '0') >= BigInt(before.xp) + BigInt(gained)
  const checkpoint_ready = !before.zone || Number(character.at_ms) > before.checkpoint_ms
  return [
    xp_ready,
    checkpoint_ready,
    gather_projected(before, context),
    inventory_projected(receipt, context.snapshot.inventory),
  ].every(Boolean)
}

// Indexed effects may arrive before the receipt. Exact reconciliation, not another packet,
// releases that barrier; command admission still validates current snapshot/clock/lease.
const projection_lane = (lane: Lane, previous: Command | null, projected: boolean, context: GameplayContext): Lane =>
  previous && projected && context.snapshot.ready
    ? { ...lane, needs_resync: false, reconciliation_command: null }
    : lane
