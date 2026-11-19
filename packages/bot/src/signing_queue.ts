// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CONTRACT_CONSTANTS } from '@aresrpg/fight'

import type { ActorSnapshot } from './actor_snapshot.ts'
import type { Lane } from './control.ts'
import { hydrate_gameplay_fight } from './gameplay.ts'
import { run_key } from './run_ref.ts'

type Observed = Pick<ActorSnapshot, 'characters' | 'fights'>

/** Chain time after which another wallet seated in the fight may pass this hero's live turn.
 * Infinity outside such a turn: in a fight seated only by this wallet a late turn loses nothing,
 * so it earns no priority over heroes that are not fighting. */
export const turn_deadline = (character_id: string, snapshot: Observed, address: string): number => {
  const seat = snapshot.characters.find(({ id }) => id === character_id)?.active_fight
  const row = seat && snapshot.fights[seat.id]
  if (!row) return Infinity
  const { contract } = hydrate_gameplay_fight(row)
  const contested = [
    contract.round > 0n,
    !contract.ended,
    contract.queue[Number(contract.turn_ptr)] === BigInt(seat.seat),
    contract.fighters.some(({ kind, dead, forfeited }) =>
      [kind.type === 'player' && kind.owner !== address, !dead, !forfeited].every(Boolean)
    ),
  ].every(Boolean)
  return contested ? Number(contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms) : Infinity
}

/** One wallet signs one transaction at a time. The queue holds heroes, never prebuilt transactions:
 * a hero whose turn another wallet could pass is asked first, the others in a ring after the last signer,
 * and each decides against fresh state only when it takes the slot. */
export const signing_order = (
  heroes: readonly string[],
  last_signer: string | undefined,
  deadline: (character_id: string) => number
): readonly string[] => {
  const ring = heroes.toSorted()
  const next = ring.findIndex((id) => id > (last_signer ?? ''))
  const waiting = next < 0 ? ring : [...ring.slice(next), ...ring.slice(0, next)]
  const due = new Map(waiting.map((id) => [id, deadline(id)]))
  // The sort is stable, so heroes without a running turn clock keep their ring order.
  return waiting.toSorted((left, right) =>
    Math.sign(Math.min(due.get(left)!, 1e300) - Math.min(due.get(right)!, 1e300))
  )
}
/** The run keys one scheduler pass asks, in signing order. The first `contested` of them have a turn
 * another wallet could pass: the wallet's waiting direct command signs right after those. */
export const signing_queue = (lane: Lane, last_signer: string | undefined, snapshot: Observed | undefined) => {
  const runs = lane.runs ?? {}
  const due = new Map(
    Object.keys(runs).map((id) => [id, snapshot ? turn_deadline(id, snapshot, lane.address) : Infinity])
  )
  const heroes = signing_order(Object.keys(runs), last_signer, (id) => due.get(id)!)
  return {
    keys: heroes.map((id) => run_key(runs[id]!)),
    contested: heroes.filter((id) => due.get(id)! < Infinity).length,
  }
}
