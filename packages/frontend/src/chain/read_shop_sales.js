// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SHOP SALES read (RPC) — the /mint catalog from the read-API `/v1/shop` view (SPEC §14 read layer), replacing
// the retired GraphQL `SaleCreated` event-replay (read_items_sales.js). The indexer serves each Sale's FACTS
// (price / supply_remaining / paused / window) off the shared `shop::Sale` — one keyless GET, no per-sale gRPC
// fan-out. The on-chain item NAME + category are DISPLAY enrichment resolved through a SECOND keyless GET — the
// `/v1/encyclopedia` items view (SPEC §14 read layer) — keyed by template_id. This REPLACES the per-template
// chain-direct `sdk.get_item_template` fan-out that fired 5 gRPC `BatchGetObjects` PER template against
// fullnode.testnet.sui.io (60 on a 6-sale /shop — CORS-blocked + 429-throttled, the display-read-law violation
// the read layer exists to kill). Art rides the on-chain Display pattern. Empty (honest) on any failure.
//
// The buy WRITE stays chain-direct through the SDK shop builders (world-shell/items_sale_actions.js); this module
// is READ-ONLY. `to_shop_row` is PURE (unit-testable without a chain) — the IO lives in `get_shop_sales`.

import { get_encyclopedia, get_shop } from '../rpc/client'
import { is_living_item } from '../pages/encyclopedia/living_corpus'

/**
 * Map one `/v1/shop` RpcSale (+ its resolved item template) to the `Sale` view row (items_shop_chain's `Sale`
 * shape — the /mint TierCard and the /shop catalog). `supply` = REMAINING (indexer-computed supply − minted); `null`
 * supply_remaining ⇒ an open edition (infinite). Art keys off the template id via the Display pattern. PURE.
 * @param {{ sale_id: string, template_id: string, price_mist: string, supply_remaining: number|null, paused: boolean }} rpc_sale
 * @param {{ name?: string, item_type?: string, category?: string }|null} template
 */
export function to_shop_row(rpc_sale, template) {
  const infinite = rpc_sale.supply_remaining == null
  const template_id = String(rpc_sale.template_id)
  const name = template?.name || template_id
  const item_type = template?.item_type || template_id
  return {
    id: String(rpc_sale.sale_id),
    template_id,
    price_mist: String(rpc_sale.price_mist),
    paused: !!rpc_sale.paused,
    supply: infinite ? 0 : Math.max(0, Number(rpc_sale.supply_remaining)), // remaining; irrelevant when infinite
    // Already-claimed units (handle_shop's own event-derived counter) — threaded through so the shop/vault
    // cards can derive the ORIGINAL cap (minted + remaining) for a "N of M remaining" supply bar, matching the
    // exact formula vault.tsx's TierCard already computes from a separate purchases-feed reconstruction.
    minted: Number(rpc_sale.minted ?? 0),
    infinite,
    treasury: '', // shop routes proceeds to the fixed @treasury (Move.toml) — not a per-sale field
    template: {
      name,
      item_type,
      category: (template?.category || 'RESOURCE').toUpperCase(),
      // Icon URLs are rendered later from an authored template slug. `item_type` is generic for most rows,
      // so constructing a URL here would recreate the exact wrong-key `/assets/items/<slot>.png` failure.
      display: { name },
    },
  }
}

/**
 * Sale supply progress for the shop's decreasing supply bar: the ORIGINAL cap (the /v1 view only ever serves
 * the REMAINING count, never the raw on-chain `Sale.supply`, so the cap is reconstructed as minted + remaining
 * — the SAME formula vault.tsx's TierCard already uses) and the minted percentage (0-100, clamped). An infinite
 * (open-edition) sale has nothing to progress toward — supply_cap/percent_minted are null; the card renders no
 * bar. PURE (no IO) — unit-tested directly.
 * @param {{ supply: number, minted?: number, infinite: boolean }} sale — a to_shop_row-shaped Sale
 * @returns {{ minted: number, supply_cap: number|null, percent_minted: number|null }}
 */
export function sale_supply_progress(sale) {
  const minted = Math.max(0, sale.minted ?? 0)
  if (sale.infinite) return { minted, supply_cap: null, percent_minted: null }
  const supply_cap = minted + Math.max(0, sale.supply)
  const percent_minted = supply_cap > 0 ? Math.min(100, (minted / supply_cap) * 100) : 0
  return { minted, supply_cap, percent_minted }
}

/**
 * Read every first-party shop sale from the RPC read-API (`/v1/shop`, active=false ⇒ ALL sales, paused included).
 * Each row's item template (name / item_type / category) is enriched from the keyless `/v1/encyclopedia` items
 * view keyed by template_id — one shared GET, NOT the per-template chain-direct `get_item_template` gRPC fan-out.
 * Empty (honest) on any transport failure; a template miss (not yet object-snapshotted) leaves the card on its
 * slug/id fallbacks. Cold sold-out finite sales are hidden (nothing to buy); PAUSED sales are KEPT (the /mint
 * card renders them GREYED by design), infinite sales always show. Sorted price ASC.
 * @returns {Promise<Array<{ id, template_id, price_mist, paused, supply, infinite, treasury, template }>>}
 */
export async function get_shop_sales() {
  let raw = []
  try {
    raw = await get_shop(false) // active=false → ALL sales; the /mint card greys paused + hides sold-out below
  } catch {
    return [] // read-API unreachable — honest empty, never a fabricated catalog
  }
  // LIVING-generation fence (burial-reseed ghost kill, 2026-07-13): a Sale whose item template is NOT in the
  // curated living whitelist (living_ids.json) sells a DEAD pre-purge orphan. Those 41 ghost Sales were
  // `shop::set_paused` on-chain (buy aborts ESalePaused — UNBUYABLE), so dropping them here is honest, not a lie
  // about what a buyer can buy (living_corpus.ts). Sales that were intentionally paused still flow through
  // and render greyed below — this drops NON-LIVING ghosts only, never legitimate paused sales.
  raw = raw.filter((s) => is_living_item({ template_id: String(s.template_id) }))
  if (!raw.length) return []

  // DISPLAY enrichment via the keyless /v1/encyclopedia items view (template_id → { name, item_type, category }).
  // A single GET (through the rpc client's LRU) replaces the old N×5 BatchGetObjects storm; a miss/failure just
  // leaves `template` undefined so to_shop_row renders the id/slug fallbacks — never a fabricated catalog.
  let tpl_by_id = new Map()
  try {
    const { items } = await get_encyclopedia('items')
    tpl_by_id = new Map(items.map((it) => [String(it.template_id), it]))
  } catch {
    /* encyclopedia unreachable — cards render on slug/id fallbacks (honest, no chain fan-out fallback) */
  }

  const rows = []
  for (const s of raw) {
    const row = to_shop_row(s, tpl_by_id.get(String(s.template_id)))
    // Hide cold sold-out finite sales (nothing to buy); KEEP paused (greyed card). Infinite sales always show.
    if (!row.infinite && row.supply <= 0 && !row.paused) continue
    rows.push(row)
  }
  return rows.sort((a, b) =>
    BigInt(a.price_mist) < BigInt(b.price_mist) ? -1 : BigInt(a.price_mist) > BigInt(b.price_mist) ? 1 : 0
  )
}
