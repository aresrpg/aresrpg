// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentStatus } from '@aresrpg/protocol'

import type { Bot } from './model.ts'
import type { Command, Lane } from './control.ts'

type WalletState = AgentStatus['state']
/** Run statuses a watching owner is shown, most active first. An ended run shows nothing. */
const RUN_STATES: readonly WalletState[] = ['active', 'waiting', 'awaiting_ai', 'paused']

/**
 * What the wallet is doing as a whole, for its owner. A stopped or uncertain wallet is said first;
 * then its command in flight; then its most active hero run. Pure: the status sharer supplies the
 * lane, the lane's active command and the run statuses it already read.
 */
export const wallet_state = (
  bot: Pick<Bot, 'status'>,
  lane: Lane,
  command: Pick<Command, 'status' | 'waiting_for_resume'> | null,
  run_statuses: readonly string[],
  now: number
): WalletState => {
  const run = RUN_STATES.find((state) => run_statuses.includes(state)) ?? null
  const gates: readonly (readonly [boolean, WalletState])[] = [
    [[bot.status !== 'ready', lane.paused].some(Boolean), 'paused'],
    [[lane.transport_stopped, command?.status === 'uncertain'].some(Boolean), 'unavailable'],
    [[Boolean(lane.active_command), !command].every(Boolean), 'unavailable'],
    [[run, command].some(Boolean) && lane.lease_until <= now, 'unavailable'],
    [Boolean(command?.waiting_for_resume), 'waiting'],
    [Boolean(command && ['accepted', 'executing'].includes(command.status)), 'active'],
    [[lane.pending, lane.reconciliation_command].some(Boolean), 'waiting'],
    [true, run ?? 'idle'],
  ]
  return gates.find(([matches]) => matches)![1]
}
