// SALE OPS read (RPC) — the admin SALE OPS panel's data (S-41 observability). Per first-party shop sale:
// supply remaining, sold count, and revenue IN — off the read-API `/v1/shop` view (the same shared `shop::Sale`
// facts the /mint catalog reads, but here we keep the RAW `minted` counter and ALL sales, including sold-out and
// paused ones — ops needs the full picture, not the buy-catalog's filtered/greyed subset).
//
// REVENUE is computed CLIENT-SIDE as `minted × current price`. DECLARED GAP (S-41): the indexer projects
// `minted` (a running unit counter via SaleBought.amount) but NO cumulative revenue and NO per-buy price, so a
// sale whose price was ever edited (shop::set_price) makes this the revenue AT THE CURRENT PRICE — an
// approximation, not the exact take. A precise figure needs a new indexer projection summing
// SaleBought.price × amount per sale; that's out of scope this pass (no new indexer work). Sales are typically
// fixed-price, so for the launch sale this equals the true revenue.
//
// `to_sale_ops_row` is PURE (unit-testable without a chain); the IO (RPC + SDK name enrichment) lives in
// `get_sale_ops`, which propagates an RpcError on transport failure so the panel renders an honest "unavailable"
// (never a fabricated zero-revenue table).

import { get_shop } from '../rpc/client'

import { get_sdk } from './sdk'

/**
 * Map one `/v1/shop` RpcSale (+ its resolved item template) to a SALE OPS row. `supply_remaining` null ⇒ an open
 * (infinite) edition; `revenue_mist` = price × minted (see the client-side revenue gap in the header). PURE.
 * @param {{ sale_id: string, template_id: string, price_mist: string, minted: number, supply_remaining: number|null, paused: boolean, starts_ms: number|null, ends_ms: number|null }} rpc_sale
 * @param {{ name?: string }|null} template
 */
export function to_sale_ops_row(rpc_sale, template) {
  const minted = Math.max(0, Number(rpc_sale.minted ?? 0))
  const price_mist = BigInt(rpc_sale.price_mist ?? '0')
  const infinite = rpc_sale.supply_remaining == null
  return {
    sale_id: String(rpc_sale.sale_id),
    template_id: String(rpc_sale.template_id),
    name: template?.name || null,
    price_mist: price_mist.toString(),
    minted,
    supply_remaining: infinite ? null : Math.max(0, Number(rpc_sale.supply_remaining)),
    infinite,
    paused: !!rpc_sale.paused,
    revenue_mist: (price_mist * BigInt(minted)).toString(),
    starts_ms: rpc_sale.starts_ms ?? null,
    ends_ms: rpc_sale.ends_ms ?? null,
  }
}

/**
 * Read EVERY first-party shop sale (active=false ⇒ all, incl. paused + sold-out) from `/v1/shop`, enriched with
 * each template's display name (best-effort via the SDK's zero-backend `get_item_template`; a name miss leaves
 * `name: null`, never blocks the row). THROWS (RpcError) on RPC transport failure — the panel catches it and
 * shows "unavailable". Returns `[]` when the RPC is up but there are no sales yet. Sorted revenue DESC (the
 * top-earning sales first — the ops read).
 * @returns {Promise<Array<ReturnType<typeof to_sale_ops_row>>>}
 */
export async function get_sale_ops() {
  const raw = await get_shop(false) // RpcError on failure → propagates → panel renders "unavailable"
  if (!raw.length) return []

  let tpl_by_id = new Map()
  try {
    const sdk = await get_sdk()
    const ids = [...new Set(raw.map((s) => String(s.template_id)).filter(Boolean))]
    const tpls = await Promise.all(ids.map((id) => sdk.get_item_template(id).catch(() => null)))
    tpl_by_id = new Map(tpls.filter(Boolean).map((t) => [String(t.id), t]))
  } catch {
    /* name enrichment is optional — rows still render with the template id as the label */
  }

  return raw
    .map((s) => to_sale_ops_row(s, tpl_by_id.get(String(s.template_id))))
    .sort((a, b) =>
      BigInt(a.revenue_mist) < BigInt(b.revenue_mist) ? 1 : BigInt(a.revenue_mist) > BigInt(b.revenue_mist) ? -1 : 0
    )
}
