// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Automatic collection of sale proceeds (owner ruling 2026-11-21: "whenever you see or receive a
// notification for an event for a sale, just auto collect the kiosk to the multisig wallet").
// The fact is the bot's own game socket: the server pushes the seller its kiosk balances
// (`packet/market_history` `profits`) after each sale, and the sale itself (`packet/listing_sold`).
// The effect is the existing `market_collect` direct command, accepted through the existing door, so it
// waits its turn in the wallet's one signing queue. There is no timer, no chain read and no second queue.
import type { ServerPacket } from '@aresrpg/protocol'

import { lane_key_for } from './command_admission.ts'
import type { Command, Lane, create_control_service } from './control.ts'
import { identifier, matches } from './gameplay_schema.ts'
import type { Bot, Grant } from './model.ts'
import type { ControlStore } from './store.ts'

/** Proceeds below this stay in the kiosk: collecting dust costs more gas than it brings (owner, 2026-11-21:
 * "auto collect from 0.1 SUI"). It counts everything the wallet's kiosks hold together. A player's own
 * `market_collect` ignores it. */
export const AUTO_COLLECT_MIN_MIST = 100_000_000n

/** The projected slice. `change` names what the last balance push showed and the latest sale known
 * then; `issued` is the change a collection was last sent for. */
type Proceeds = Readonly<{ sale: string | null; kiosks: readonly string[]; change: string; issued: string }>
export const empty_proceeds = (): Proceeds => ({ sale: null, kiosks: [], change: '', issued: '' })

/** A sale only enriches the next balance push: it makes that push a new change even when the kiosk
 * holds the same amount as before the last collection. It never asks for a collection by itself. */
export const fold_proceeds = (state: Proceeds, packet: ServerPacket | null | undefined): Proceeds => {
  if (packet?.type === 'packet/listing_sold') return { ...state, sale: packet.sale.id }
  if (packet?.type !== 'packet/market_history') return state
  const held = packet.profits
    .filter(({ kiosk, amount_mist }) => matches(identifier, kiosk) && /^[1-9][0-9]*$/.test(amount_mist))
    .map(({ kiosk, amount_mist }) => [kiosk, amount_mist] as const)
    .toSorted(([left], [right]) => left.localeCompare(right))
  const change = JSON.stringify([state.sale, held])
  if (change === state.change) return state
  const total = held.reduce((sum, [, amount_mist]) => sum + BigInt(amount_mist), 0n)
  // Below the minimum no kiosk is named, so nothing is due; the next push that crosses it is a new change.
  return { ...state, kiosks: total >= AUTO_COLLECT_MIN_MIST ? held.map(([kiosk]) => kiosk) : [], change }
}
/** Proceeds are held, and no collection was sent for this observed change yet. */
export const collection_due = (state: Proceeds) => state.kiosks.length > 0 && state.change !== state.issued

/** Refusals that say "not now" or "not this grant": the collection stays due for a later observation. */
const NOT_NOW = new Set(['bot_busy_or_paused', 'needs_resync', 'service_unavailable'])
const NOT_THIS_GRANT = new Set(['invalid_token', 'insufficient_scope'])
const refusal = (error: unknown) => (error instanceof Error ? error.message : '')
/** A player's direct command is replaced only once its outcome is final: an unknown one stays visible. */
const FINAL: readonly string[] = ['completed', 'failed', 'cancelled']

type Control = Pick<ReturnType<typeof create_control_service>, 'accept'>
/**
 * One collector per wallet session, fed by every packet of the bot's own socket in arrival order.
 * It sends at most one `market_collect` per observed change, under a live play grant of the owner,
 * and only into a free direct slot. `grants` are the connector grants of the session; `share` pushes
 * the wallet status first, so the owner's clients see the previous direct command's outcome.
 */
export const create_market_collector = (
  store: ControlStore,
  control: Control,
  bot: Pick<Bot, 'network' | 'address'>,
  grants: ReadonlySet<string>,
  share: () => Promise<void>,
  report_failure: (error: unknown) => void
) => {
  let state = empty_proceeds()
  const free_lane = async () => {
    const lane = await store.read<Lane>(lane_key_for(bot))
    const held = lane?.direct ? await store.read<Command>(`command:${lane.direct}`) : null
    return lane && !lane.paused && (!held || FINAL.includes(held.status)) ? lane : null
  }
  const accept = (grant: Grant, lane: Lane, { kiosks, change }: Proceeds) =>
    control.accept(grant, {
      idempotency_key: `market_collect:${lane.fence}:${change}`,
      kind: 'market_collect',
      payload: { kiosks },
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    })
  /** True once a command is accepted; false while nothing may be sent yet. */
  const send = async (due: Proceeds) => {
    const lane = await free_lane()
    if (!lane) return false
    const rows = await Promise.all([...grants].map((id) => store.read<Grant>(`grant:${id}`)))
    const players = rows.filter((row): row is Grant => Boolean(row?.scopes.includes('bot:play')))
    if (players.length) await share()
    for (const grant of players) {
      try {
        await accept(grant, lane, due)
        return true
      } catch (error) {
        if (!NOT_THIS_GRANT.has(refusal(error))) throw error
      }
    }
    return false
  }
  /** Fed with every packet, in order. Never throws: a failure here must not close the bot's socket. */
  return async (packet: ServerPacket | null | undefined) => {
    state = fold_proceeds(state, packet)
    if (!collection_due(state)) return
    const due = state
    try {
      if (await send(due)) state = { ...state, issued: due.change }
    } catch (error) {
      if (NOT_NOW.has(refusal(error))) return
      // An unexpected refusal is reported once: this change is given up, the next one is tried again.
      state = { ...state, issued: due.change }
      report_failure(error)
    }
  }
}
