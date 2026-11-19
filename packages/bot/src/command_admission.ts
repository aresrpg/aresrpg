// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Command, Lane } from './control.ts'
import type { Bot, Grant } from './model.ts'
import { public_command_error } from './planning_failure.ts'

/** The client view of a command: everything except its receipt body, and its error as a code only. */
export const public_command = ({ receipt: _receipt, ...command }: Command) => ({
  ...command,
  error: public_command_error(command.status, command.error),
})

export const lane_key_for = (bot: Pick<Bot, 'network' | 'address'>) => `lane:${bot.network}:${bot.address}`

type Admission = Readonly<{ kind: Command['kind']; decision_revision: number; observation_revision: number }>
const assert_playable = (grant: Grant, kind: Command['kind']) => {
  if (kind === 'observe') throw new Error('invalid_action')
  if (!grant.scopes.includes('bot:play')) throw new Error('insufficient_scope')
}
/** A command takes the single signing slot: nothing in flight, and the exact state it was chosen against. */
export const admit_command = (grant: Grant, lane: Lane, input: Admission, now: number, freshness_ms: number) => {
  assert_playable(grant, input.kind)
  if ([lane.paused, lane.active_command, lane.pending].some(Boolean)) throw new Error('bot_busy_or_paused')
  if (
    [
      lane.needs_resync,
      lane.observed_at + freshness_ms <= now,
      lane.lease_until <= now,
      input.decision_revision !== lane.decision_revision,
      input.observation_revision !== lane.observation_revision,
    ].some(Boolean)
  )
    throw new Error('needs_resync')
}

/** A direct command that still waits for the signing slot: accepted, named by its lane, not yet in the slot. */
export const direct_waiting = (lane: Lane, command: Command | null): command is Command =>
  [command?.status === 'accepted', lane.direct === command?.id, lane.active_command !== command?.id].every(Boolean)

/** A direct command joins the signing queue as a one-shot entry, so it never needs an idle wallet:
 * it waits its turn among the heroes and is validated against fresh state when it takes the slot.
 * A wallet holds one at a time, and it joins under the wallet decision its client observed. */
export const queue_command = (
  grant: Grant,
  lane: Lane,
  held: Command | null,
  input: Admission,
  now: number,
  freshness_ms: number
) => {
  assert_playable(grant, input.kind)
  const unsettled = held !== null && ['accepted', 'executing'].includes(held.status)
  if ([lane.paused, unsettled].some(Boolean)) throw new Error('bot_busy_or_paused')
  if (
    [
      lane.observed_at + freshness_ms <= now,
      lane.lease_until <= now,
      input.decision_revision !== lane.decision_revision,
      input.observation_revision > lane.observation_revision,
    ].some(Boolean)
  )
    throw new Error('needs_resync')
}
