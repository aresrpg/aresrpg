// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { same_hosted_bot, type HostedBotDescriptor, type HostedReturnResponse } from '@aresrpg/protocol'

import { cleared_run, run_keys } from './run_ref.ts'
import type { BehaviorRun as Run } from './behavior_script.ts'
import type { ControlTransaction } from './store.ts'
import type { Lane } from './control.ts'
import { public_bot, type Bot } from './model.ts'

export type ReturnTransition = Readonly<{ bot: Bot; lane: Lane; result: HostedReturnResponse }>
const same_identity = (bot: Bot, review: HostedBotDescriptor) =>
  [
    bot.id === review.id,
    bot.address === review.address,
    bot.multisig_public_key === review.multisig_public_key,
    bot.policy.revision === review.policy_revision,
  ].every(Boolean)
// Stopped means no live process owns in-flight work, not proof of historical chain settlement.
// After process loss, the owner SDK must inspect current custody before returning assets.
const drained = (lane: Lane, now: number) =>
  ![lane.pending, lane.active_command, lane.execution_busy && lane.lease_until > now].some(Boolean)
const stopped = (bot: Bot, lane: Lane, now: number): ReturnTransition => ({
  bot,
  lane,
  result: { bot: public_bot(bot), phase: drained(lane, now) ? 'stopped' : 'draining' },
})

/** Grant generation fences new admissions; the actor lease survives solely to settle its existing envelope. */
export const begin_owner_return = (
  bot: Bot,
  lane: Lane,
  review: HostedBotDescriptor,
  now = Date.now()
): ReturnTransition => {
  if (!same_identity(bot, review)) throw new Error('connection_changed')
  if (bot.status === 'returning') {
    if (![bot.generation, bot.generation - 1].includes(review.generation)) throw new Error('connection_changed')
    return stopped(bot, lane, now)
  }
  if (!same_hosted_bot(public_bot(bot), review)) throw new Error('connection_changed')
  if (!Number.isSafeInteger(bot.generation + 1)) throw new Error('invalid_generation')
  return stopped(
    { ...bot, generation: bot.generation + 1, status: 'returning' },
    {
      ...lane,
      paused: true,
      needs_resync: true,
      ...cleared_run,
      decision_revision: lane.decision_revision + 1,
    },
    now
  )
}

const inspect_owner_return = (
  bot: Bot,
  lane: Lane,
  review: HostedBotDescriptor,
  now = Date.now()
): ReturnTransition => {
  if (![same_identity(bot, review), bot.generation === review.generation, bot.status === 'returning'].every(Boolean))
    throw new Error('connection_changed')
  return stopped(bot, lane, now)
}

/** The owner releases the return barrier after the SDK verifies the completed asset return. Old grants stay invalid. */
export const complete_owner_return = (
  bot: Bot,
  lane: Lane,
  review: HostedBotDescriptor,
  now = Date.now()
): ReturnTransition => {
  if (![same_identity(bot, review), bot.generation === review.generation].every(Boolean))
    throw new Error('connection_changed')
  if (bot.status === 'ready') return { bot, lane, result: { bot: public_bot(bot), phase: 'complete' } }
  inspect_owner_return(bot, lane, review, now)
  if (!drained(lane, now)) throw new Error('return_not_ready')
  const next: Bot = { ...bot, status: 'ready' }
  return {
    bot: next,
    lane: { ...lane, paused: false, needs_resync: true, decision_revision: lane.decision_revision + 1 },
    result: { bot: public_bot(next), phase: 'complete' },
  }
}

export const stop_return_runs = async (tx: ControlTransaction, bot: Bot, previous: Lane, next: Lane) => {
  if (run_keys(next).length) return
  for (const key of run_keys(previous)) {
    const run = await tx.get<Run>(key)
    if (!run || run.bot_id !== bot.id) throw new Error('run_reference_conflict')
    await tx.put(key, { ...run, status: 'stopped' })
  }
}
