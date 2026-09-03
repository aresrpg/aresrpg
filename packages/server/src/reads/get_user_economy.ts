// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The load snapshot's economy slice, one home: the user's kiosks, pending grind-safe claims,
// giftcard vouchers, ACTIVE listings, and pending exclusive offers (held PurchaseCaps).

import type { ClaimRow, GiftcardRow, ListingRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

export async function get_kiosks(graph: Graph, { address }: { address: string }) {
  const rows = await graph.read(`MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk) RETURN k.id AS kiosk`, {
    address,
  })
  return rows.map(({ kiosk }) => kiosk as string)
}

export async function get_claims(graph: Graph, { address }: { address: string }): Promise<ClaimRow[]> {
  const rows = await graph.read(
    `MATCH (:User {address: $address})-[:HOLDS_CLAIM]->(c) RETURN c AS claim, labels(c) AS kinds`,
    { address }
  )
  return rows
    .filter(({ claim }) => claim)
    .map(({ claim, kinds }) => {
      const props = (claim as Node)!.properties as { id: string; rolled_template?: string; amount?: number }
      const kind = (kinds as string[]).includes('CrushClaim') ? ('crush' as const) : ('box' as const)
      // a box claim carries its projected roll so the silent redeem composes chain-read-free
      return kind === 'box'
        ? { id: props.id, kind, rolled_template: props.rolled_template, amount: Number(props.amount ?? 1) }
        : { id: props.id, kind }
    })
}

export async function get_giftcards(graph: Graph, { address }: { address: string }): Promise<GiftcardRow[]> {
  const rows = await graph.read(
    `MATCH (:User {address: $address})-[:HOLDS_VOUCHER]->(g:Giftcard) RETURN g AS giftcard`,
    { address }
  )
  return rows
    .filter(({ giftcard }) => giftcard)
    .map(({ giftcard }) => {
      const { id, template, amount } = (giftcard as Node)!.properties
      return { id: String(id), template: String(template), amount: Number(amount) }
    })
}

/** The user's own ACTIVE listings — whatever price tag hangs off their kiosks. */
export async function get_my_listings(graph: Graph, { address }: { address: string }): Promise<ListingRow[]> {
  const rows = await graph.read(
    `
    MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk)<-[l:LISTED_IN {exclusive: false}]-(asset)
    WHERE asset:Item OR asset:Character
    RETURN asset, labels(asset) AS kinds, l.price AS price_mist, l.at_ms AS at_ms, k.id AS kiosk`,
    { address }
  )
  return rows
    .filter(({ asset }) => asset)
    .map(({ asset, kinds, price_mist, at_ms, kiosk }) => {
      const row = (asset as Node)!.properties
      const kind = (kinds as string[]).includes('Character') ? ('character' as const) : ('item' as const)
      return {
        kind,
        id: String(row.id),
        name: String(row.name),
        item_type: kind === 'item' ? String(row.item_type) : null,
        category: kind === 'item' ? String(row.category) : null,
        level: Number(row.level),
        amount: kind === 'item' ? Number(row.amount) : 1,
        ...(kind === 'character' ? { classe: String(row.classe) } : {}),
        price_mist: String(price_mist),
        at_ms: Number(at_ms),
        kiosk: String(kiosk),
        seller: address,
      }
    })
}
