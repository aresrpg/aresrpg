// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGraphQLClient } from '@mysten/sui/graphql'

import { GiftError } from './gift_contract.ts'
import type { GiftPolicy } from './gift_provenance.ts'

type EventHint = Readonly<{
  transaction: Readonly<{ digest: string }>
  contents: Readonly<{ json: Record<string, unknown> }>
}>
type Page = Readonly<{ nodes: readonly EventHint[]; pageInfo: Readonly<{ hasPreviousPage: boolean }> }>
export type GiftHistory = Readonly<{ redemptions: Page; openings: Page; collections: Page }>

/** Recovery discovers bounded digest hints only. gRPC certified receipts prove every linked action. */
export const read_gift_history = async (
  client: SuiGraphQLClient,
  policy: GiftPolicy,
  address: string
): Promise<GiftHistory> => {
  const result = await client.query<GiftHistory>({
    query: `query GiftHistory($address: SuiAddress!, $redeem: String!, $open: String!, $collect: String!) {
      redemptions: events(filter: {sender: $address, type: $redeem}, last: 50) {
        pageInfo {hasPreviousPage} nodes {transaction {digest} contents {json}}
      }
      openings: events(filter: {sender: $address, type: $open}, last: 50) {
        pageInfo {hasPreviousPage} nodes {transaction {digest} contents {json}}
      }
      collections: events(filter: {sender: $address, type: $collect}, last: 50) {
        pageInfo {hasPreviousPage} nodes {transaction {digest} contents {json}}
      }
    }`,
    variables: {
      address,
      redeem: `${policy.game_type}::distribution::GiftcardRedeemed`,
      open: `${policy.game_type}::loot_box::LootBoxOpened`,
      collect: `${policy.game_type}::loot_box::LootClaimed`,
    },
  })
  if (result.errors?.length || !result.data)
    throw new GiftError('unavailable', {
      cause: new Error(result.errors?.map(({ message }) => message).join('; ') || 'Gift history is missing'),
    })
  return result.data
}

export const redemption_hint = (policy: GiftPolicy, history: GiftHistory, giftcard?: string) => {
  const candidates = history.redemptions.nodes.toReversed()
  return candidates.find(({ contents }) => {
    const id = contents.json.giftcard
    return typeof id === 'string' && policy.giftcards.has(id) && (!giftcard || id === giftcard)
  })
}

export const box_hints = (policy: GiftPolicy, page: Page): readonly string[] =>
  [
    ...new Set(
      page.nodes
        .filter(({ contents }) => contents.json.box_template === policy.box_template)
        .map(({ transaction }) => transaction.digest)
    ),
  ].toReversed()
