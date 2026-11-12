// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { same_hosted_bot, type HostedBotDescriptor, type HostedReturnResponse } from '@aresrpg/protocol'

import type { ControlTransaction } from './store.ts'
import type { ProfessionRun } from './profession_control.ts'
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
const drained = (lane: Lane) => ![lane.pending, lane.active_command].some(Boolean)
const stopped = (bot: Bot, lane: Lane): ReturnTransition => ({
  bot,
  lane,
  result: { bot: public_bot(bot), phase: drained(lane) ? 'stopped' : 'draining' },
})

/** Grant generation fences new admissions; the actor lease survives solely to settle its existing envelope. */
export const begin_owner_return = (bot: Bot, lane: Lane, review: HostedBotDescriptor): ReturnTransition => {
  if (!same_identity(bot, review)) throw new Error('connection_changed')
  if (bot.status === 'returning') {
    if (![bot.generation, bot.generation - 1].includes(review.generation)) throw new Error('connection_changed')
    return stopped(bot, lane)
  }
  if (!same_hosted_bot(public_bot(bot), review)) throw new Error('connection_changed')
  if (!Number.isSafeInteger(bot.generation + 1)) throw new Error('invalid_generation')
  return stopped(
    { ...bot, generation: bot.generation + 1, status: 'returning' },
    {
      ...lane,
      paused: true,
      needs_resync: true,
      profession_run_id: null,
      combat_run_id: null,
      decision_revision: lane.decision_revision + 1,
    }
  )
}

export const inspect_owner_return = (bot: Bot, lane: Lane, review: HostedBotDescriptor): ReturnTransition => {
  if (![same_identity(bot, review), bot.generation === review.generation, bot.status === 'returning'].every(Boolean))
    throw new Error('connection_changed')
  return stopped(bot, lane)
}

/** The owner releases the return barrier after the SDK verifies the completed asset return. Old grants stay invalid. */
export const complete_owner_return = (bot: Bot, lane: Lane, review: HostedBotDescriptor): ReturnTransition => {
  if (![same_identity(bot, review), bot.generation === review.generation].every(Boolean))
    throw new Error('connection_changed')
  if (bot.status === 'ready') return { bot, lane, result: { bot: public_bot(bot), phase: 'complete' } }
  inspect_owner_return(bot, lane, review)
  if (!drained(lane)) throw new Error('return_not_ready')
  const next: Bot = { ...bot, status: 'ready' }
  return {
    bot: next,
    lane: { ...lane, paused: false, needs_resync: true, decision_revision: lane.decision_revision + 1 },
    result: { bot: public_bot(next), phase: 'complete' },
  }
}

export const stop_return_profession = async (tx: ControlTransaction, bot: Bot, id: string): Promise<void> => {
  const run = await tx.get<ProfessionRun>(`profession:${id}`)
  if (run && run.bot_id !== bot.id) throw new Error('profession_run_conflict')
  if (run) await tx.put(`profession:${id}`, { ...run, status: 'stopped' })
}

const stop_return_combat = async (tx: ControlTransaction, bot: Bot, previous: Lane, next: Lane) => {
  if (!previous.combat_run_id || next.combat_run_id !== null) return
  const run = await tx.get<import('./combat_control.ts').CombatRun>(`combat:${previous.combat_run_id}`)
  if (!run || run.bot_id !== bot.id) throw new Error('combat_run_conflict')
  await tx.put(`combat:${run.id}`, { ...run, status: 'stopped' })
}

export const stop_return_runs = async (tx: ControlTransaction, bot: Bot, previous: Lane, next: Lane) => {
  if (previous.profession_run_id && next.profession_run_id === null)
    await stop_return_profession(tx, bot, previous.profession_run_id)
  await stop_return_combat(tx, bot, previous, next)
}
