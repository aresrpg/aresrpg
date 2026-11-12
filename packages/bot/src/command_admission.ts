// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { run_ref_of } from './run_ref.ts'
import type { Command, Lane } from './control.ts'
import type { Bot, Grant } from './model.ts'

export const lane_key_for = (bot: Pick<Bot, 'network' | 'address'>) => `lane:${bot.network}:${bot.address}`

export const admit_command = (
  grant: Grant,
  lane: Lane,
  input: Readonly<{
    kind: Command['kind']
    decision_revision: number
    observation_revision: number
  }>,
  now: number,
  freshness_ms: number
) => {
  if (input.kind === 'observe') throw new Error('invalid_action')
  if (!grant.scopes.includes('bot:play')) throw new Error('insufficient_scope')
  if (lane_busy(lane)) throw new Error('bot_busy_or_paused')
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

/** Every autonomous domain shares the same wallet admission slot. */
export const lane_busy = (lane: Lane) =>
  [lane.paused, lane.active_command, lane.pending, run_ref_of(lane)].some(Boolean)
