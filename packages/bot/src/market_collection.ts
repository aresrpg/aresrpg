// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Automatic collection of sale proceeds (owner ruling 2026-11-21: "whenever you see or receive a
// notification for an event for a sale, just auto collect the kiosk to the multisig wallet").
// The fact is the bot's own game socket: the server pushes the seller its kiosk balances
// (`packet/market_history` `profits`) after each sale, and the sale itself (`packet/listing_sold`).
// The effect is the existing `market_collect` direct command, sent as every command the wallet sends by
// itself (`own_commands.ts`).
import type { ServerPacket } from '@aresrpg/protocol'

import { identifier, matches } from './gameplay_schema.ts'
import { refused_for_now, type OwnSender } from './own_commands.ts'

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

/**
 * One collector per wallet session, fed by every packet of the bot's own socket in arrival order.
 * It sends at most one `market_collect` per observed change, through the wallet's own-command sender.
 */
export const create_market_collector = (send: OwnSender, report_failure: (error: unknown) => void) => {
  let state = empty_proceeds()
  const collect = ({ kiosks, change }: Proceeds) =>
    send((lane) => ({
      idempotency_key: `market_collect:${lane.fence}:${change}`,
      kind: 'market_collect',
      payload: { kiosks },
    }))
  /** Fed with every packet, in order. Never throws: a failure here must not close the bot's socket. */
  return async (packet: ServerPacket | null | undefined) => {
    state = fold_proceeds(state, packet)
    if (!collection_due(state)) return
    const due = state
    try {
      if (await collect(due)) state = { ...state, issued: due.change }
    } catch (error) {
      if (refused_for_now(error)) return
      // An unexpected refusal is reported once: this change is given up, the next one is tried again.
      state = { ...state, issued: due.change }
      report_failure(error)
    }
  }
}
