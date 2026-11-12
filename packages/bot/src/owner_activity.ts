// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedAgentActivity } from '@aresrpg/protocol'

import type { Bot, Grant } from './model.ts'
import type { ControlStore } from './store.ts'
import type { Command, Lane } from './control.ts'
import { empty_lane } from './control.ts'
import { lane_key_for } from './command_admission.ts'
import { run_keys } from './run_ref.ts'
import type { Run } from './run_plan.ts'
import { behavior_character_ids } from './behavior_projection.ts'

const state = (status: HostedAgentActivity['status']): HostedAgentActivity => ({
  status,
  character_ids: [],
  objective: null,
})
const activity_keys = (lane: Lane) => [
  ...run_keys(lane),
  ...(lane.active_command ? [`command:${lane.active_command}`] : []),
]
const RUN_STATUS: Partial<Record<Run['status'], HostedAgentActivity['status']>> = {
  active: 'active',
  waiting: 'waiting',
  awaiting_ai: 'awaiting_ai',
  paused: 'paused',
}
const owned_run = (run: Run | null, bot: Bot, grants: readonly Grant[]) =>
  !run ||
  [run.bot_id === bot.id, run.lane_key === lane_key_for(bot), grants.some(({ id }) => id === run.grant_id)].every(
    Boolean
  )
const run_activity = (run: Run | null, now: number): HostedAgentActivity | null => {
  if (!run) return null
  const status = RUN_STATUS[run.status]
  if (status === undefined) return null
  if ('script' in run)
    return {
      status,
      character_ids: behavior_character_ids(run.script),
      objective: run.script.objective,
      issue: run.issue,
    }
  if ('plan' in run) {
    if (Number(run.plan.deadline_ms) <= now) return null
    return { status, character_ids: [run.plan.character_id], objective: run.plan.objective ?? null }
  }
  return {
    status,
    character_ids: run.profiles.map(({ character_id }) => character_id),
    objective: run.objective ?? null,
  }
}
const execution_status = (
  bot: Bot,
  lane: Lane,
  command: Command | null,
  run: HostedAgentActivity | null,
  now: number
) => {
  const gates: readonly (readonly [boolean, HostedAgentActivity['status']])[] = [
    [[bot.status !== 'ready', lane.paused].some(Boolean), 'paused'],
    [[lane.transport_stopped, command?.status === 'uncertain'].some(Boolean), 'unavailable'],
    [[Boolean(lane.active_command), !command].every(Boolean), 'unavailable'],
    [[run, command].some(Boolean) && lane.lease_until <= now, 'unavailable'],
    [Boolean(command?.waiting_for_resume), 'waiting'],
    [Boolean(command && ['accepted', 'executing'].includes(command.status)), 'active'],
    [[lane.pending, lane.reconciliation_command].some(Boolean), 'waiting'],
    [true, run?.status ?? 'idle'],
  ]
  return gates.find(([matches]) => matches)![1]
}
/** Disposable owner read of the existing wallet lane. Never scan historical runs or retain another status. */
export const read_owner_activity = async (
  store: ControlStore,
  bot: Bot,
  grants: readonly Grant[],
  now: number
): Promise<HostedAgentActivity | undefined> => {
  if (!grants.length) return undefined
  const lane_key = lane_key_for(bot)
  const before = (await store.read<Lane>(lane_key)) ?? empty_lane(bot)
  return store
    .transaction([lane_key, ...activity_keys(before)], async (tx) => {
      const lane = (await tx.get<Lane>(lane_key)) ?? empty_lane(bot)
      if (activity_keys(lane).join('|') !== activity_keys(before).join('|')) return state('unavailable')
      const [key] = run_keys(lane)
      const [record, command] = await Promise.all([
        key ? tx.get<Run>(key) : Promise.resolve(null),
        lane.active_command ? tx.get<Command>(`command:${lane.active_command}`) : Promise.resolve(null),
      ])
      if (!owned_run(record, bot, grants)) return state('unavailable')
      const run = run_activity(record, now)
      const character_ids = [command?.payload.character_id].filter((id): id is string => typeof id === 'string')
      return { ...(run ?? { character_ids, objective: null }), status: execution_status(bot, lane, command, run, now) }
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === 'control_transaction_conflict') return state('unavailable')
      throw error
    })
}
