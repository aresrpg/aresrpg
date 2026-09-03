// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MasteryOfferRow, MasteryRow } from '@aresrpg/protocol'

import type { Graph, Node } from '../graph.ts'

const string_or_null = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

const shape_mastery = (address: string, user: Record<string, unknown> | undefined): MasteryRow | null =>
  user && typeof user.mastery_id === 'string'
    ? Object.freeze({
        id: user.mastery_id,
        owner: address,
        points: String(user.mastery_points ?? 0),
        last_completed_epoch: string_or_null(user.mastery_last_completed_epoch),
        quest_epoch: String(user.mastery_quest_epoch ?? 0),
        quest_started_ms: String(user.mastery_quest_started_ms ?? 0),
        quest_world: String(user.mastery_quest_world ?? ''),
        quest_dungeon: String(user.mastery_quest_dungeon ?? ''),
        quest_reward: Number(user.mastery_quest_reward ?? 0),
        quest_completed: Boolean(user.mastery_quest_completed),
      })
    : null

const shape_offer = (node: Node): MasteryOfferRow | null => {
  const row = node?.properties
  return row && typeof row.id === 'string'
    ? Object.freeze({
        id: row.id,
        item_type: String(row.item_type),
        template: String(row.template),
        cost: String(row.cost),
        enabled: Boolean(row.enabled),
      })
    : null
}

export async function get_mastery(
  graph: Graph,
  { address }: Readonly<{ address: string }>
): Promise<Readonly<{ mastery: MasteryRow | null; offers: MasteryOfferRow[] }>> {
  const [result] = await graph.read(
    `OPTIONAL MATCH (u:User {address: $address})
     OPTIONAL MATCH (offer:MasteryOffer)
     RETURN u AS user, collect(offer) AS offers`,
    { address }
  )
  const user = (result?.user as Node)?.properties
  const mastery = shape_mastery(address, user)
  const offers = ((result?.offers as Node[] | undefined) ?? [])
    .map(shape_offer)
    .filter((offer): offer is MasteryOfferRow => offer !== null)
  return Object.freeze({ mastery, offers })
}
