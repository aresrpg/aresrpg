// LIVE /v1 shop snapshot for the shop content ceremony (extracted from apply_shop_payload.mjs —
// the 600-LoC file law). Runtime truth comes from the keyless read layer: `/v1/shop?active=false`
// (every sale, paused included) joined with `/v1/encyclopedia?kind=items` on template_id, every row
// validated LOUDLY before any plan is built — a malformed row throws with zero chain writes
// attempted. Pure transport + normalization only; all plan/tx logic stays in apply_shop_payload.mjs.

const rpc_origin = 'https://rpc.aresrpg.world'

async function fetch_json(url, fetch_impl) {
  const response = await fetch_impl(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(
      `${url}: HTTP ${response.status}; no chain writes attempted`
    )
  return response.json()
}
function normalize_sale(row) {
  const sale_id = String(row?.sale_id ?? '')
  const template_id = String(row?.template_id ?? '')
  const minted = Number(row?.minted)
  const supply_remaining =
    row?.supply_remaining == null ? null : Number(row.supply_remaining)
  const paused = row?.paused
  let price_mist
  try {
    price_mist = String(BigInt(row?.price_mist))
  } catch {
    throw new Error(`sale ${sale_id || '(missing)'} has invalid price_mist`)
  }
  if (!sale_id || !template_id)
    throw new Error('shop API row lacks sale_id/template_id')
  if (!Number.isSafeInteger(minted) || minted < 0)
    throw new Error(`sale ${sale_id} has invalid minted`)
  if (
    supply_remaining != null &&
    (!Number.isSafeInteger(supply_remaining) || supply_remaining < 0)
  )
    throw new Error(`sale ${sale_id} has invalid supply_remaining`)
  if (typeof paused !== 'boolean')
    throw new Error(`sale ${sale_id} has invalid paused`)
  return {
    sale_id,
    template_id,
    price_mist,
    minted,
    supply_remaining,
    paused,
  }
}
function normalize_template(row) {
  const template_id = String(row?.template_id ?? '')
  if (!template_id) throw new Error('encyclopedia item lacks template_id')
  return {
    template_id,
    item_type: row.item_type ?? null,
    name: row.name ?? null,
    description: row.description ?? null,
    level: row.level == null ? null : Number(row.level),
    category: row.category ?? null,
  }
}
export async function fetch_live_rows(fetch_impl = fetch) {
  const [shop, encyclopedia] = await Promise.all([
    fetch_json(`${rpc_origin}/v1/shop?active=false`, fetch_impl),
    fetch_json(`${rpc_origin}/v1/encyclopedia?kind=items`, fetch_impl),
  ])
  if (!Array.isArray(shop?.sales))
    throw new Error('/v1/shop response has no sales array')
  if (!Array.isArray(encyclopedia?.items))
    throw new Error('/v1/encyclopedia response has no items array')
  const template_by_id = new Map()
  for (const raw_template of encyclopedia.items) {
    const template = normalize_template(raw_template)
    if (template_by_id.has(template.template_id))
      throw new Error(
        `/v1/encyclopedia returned duplicate template ${template.template_id}`
      )
    template_by_id.set(template.template_id, template)
  }
  const sale_rows = shop.sales.map((raw_sale) => {
    const sale = normalize_sale(raw_sale)
    return {
      ...sale,
      template: template_by_id.get(sale.template_id) ?? null,
    }
  })
  return { sale_rows, template_by_id }
}
