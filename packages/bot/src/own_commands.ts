// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The commands a wallet sends by itself, from a fact its own game socket showed (collected proceeds,
// a fight given up). Each one is an ordinary direct command, accepted through the existing door under
// a live play grant of the owner, so it waits its turn in the wallet's one signing queue. There is no
// timer, no chain read and no second queue.
import { lane_key_for } from './command_admission.ts'
import type { Command, Lane, create_control_service } from './control.ts'
import type { Bot, Grant } from './model.ts'
import type { ControlStore } from './store.ts'

/** Refusals that say "not now" or "not this grant": the command stays due for a later observation. */
const NOT_NOW = new Set(['bot_busy_or_paused', 'needs_resync', 'service_unavailable'])
const NOT_THIS_GRANT = new Set(['invalid_token', 'insufficient_scope'])
const refusal = (error: unknown) => (error instanceof Error ? error.message : '')
export const refused_for_now = (error: unknown) => NOT_NOW.has(refusal(error))
/** A player's direct command is replaced only once its outcome is final: an unknown one stays visible. */
const FINAL: readonly string[] = ['completed', 'failed', 'cancelled']

type Control = Pick<ReturnType<typeof create_control_service>, 'accept'>
type OwnCommand = Pick<Parameters<Control['accept']>[1], 'idempotency_key' | 'kind' | 'payload'>
/**
 * One sender per wallet session. It sends into a free direct slot only, never over a player's command
 * whose outcome is still unknown. `grants` are the connector grants of the session; `share` pushes the
 * wallet status first, so the owner's clients see the previous direct command's outcome.
 * True once a command is accepted; false while nothing may be sent yet.
 */
export const create_own_sender = (
  store: ControlStore,
  control: Control,
  bot: Pick<Bot, 'network' | 'address'>,
  grants: ReadonlySet<string>,
  share: () => Promise<void>
) => {
  const free_lane = async () => {
    const lane = await store.read<Lane>(lane_key_for(bot))
    const held = lane?.direct ? await store.read<Command>(`command:${lane.direct}`) : null
    return lane && !lane.paused && (!held || FINAL.includes(held.status)) ? lane : null
  }
  /** `command` reads the lane it would be sent into and answers null when that lane makes it moot. */
  return async (command: (lane: Lane) => OwnCommand | null): Promise<boolean> => {
    const lane = await free_lane()
    const own = lane && command(lane)
    if (!lane || !own) return false
    const rows = await Promise.all([...grants].map((id) => store.read<Grant>(`grant:${id}`)))
    const players = rows.filter((row): row is Grant => Boolean(row?.scopes.includes('bot:play')))
    if (players.length) await share()
    for (const grant of players) {
      try {
        await control.accept(grant, {
          ...own,
          decision_revision: lane.decision_revision,
          observation_revision: lane.observation_revision,
        })
        return true
      } catch (error) {
        if (!NOT_THIS_GRANT.has(refusal(error))) throw error
      }
    }
    return false
  }
}
export type OwnSender = ReturnType<typeof create_own_sender>
