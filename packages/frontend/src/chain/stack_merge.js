// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 — the two PURE halves of the duplicate-stack sweep.
//
// WHY IT EXISTS: every stackable acquisition MINTS A NEW Item (item.move `mint`/`y54` — a shop buy, a gather,
// a loot roll, a gift claim), so a player who picks up bread ten times owns ten Item objects of amount 1
// instead of one stack of ten. The merge door has existed on chain the whole time (item::merge, wrapped
// custody-safe by extract::merge_locked_stacks_and_relock) and the SDK composes it; nothing here is new
// mechanics — this is the projection that decides WHICH duplicates fold into WHICH survivor.
//
// No chain, no store, no effects: a bag in, a plan out; a receipt in, the fold input out.

/**
 * Which same-template duplicates in a bag can be folded, and into which canonical stack.
 *
 * The CANONICAL is the LARGEST stack (folding the small into the big keeps every future amount check on the
 * row a player already recognises), tie-broken on the lowest object id — object ids carry no age, so this is a
 * DETERMINISM rule, not an "oldest" one: the same bag always yields the same plan.
 *
 * Three exclusions, each because the chain would abort otherwise:
 *   • non-stackable rows — two identical gear NFTs are distinct objects (`ENotStackable`)
 *   • rows without a template id — same `item_type` is NOT proof of same template (`ETemplateMismatch`)
 *   • rows in DIFFERENT kiosks — the Move door extracts and re-locks through ONE kiosk + its cap
 * A `listed` row is marketplace inventory, not bag inventory: merging it would need a delist first.
 *
 * @param {any[]} items  bag rows (read_staking.get_owned_items shape, both the /v1 and chain-walk paths)
 * @returns {{ kiosk_id: string, target_item_id: string, source_item_id: string }[]} one entry per source
 */
export function plan_stack_merges(items) {
  /** @type {Map<string, { id: string, kiosk_id: string, amount: number }[]>} */
  const groups = new Map()
  for (const item of items ?? []) {
    if (item?.stackable !== true || item?.listed === true) continue
    const id = String(item?.id ?? '')
    const kiosk_id = String(item?.kiosk_id ?? '')
    const template_id = String(item?.template_id ?? '')
    if (!id || !kiosk_id || !template_id) continue
    const key = `${kiosk_id}::${template_id}`
    groups.set(key, [...(groups.get(key) ?? []), { id, kiosk_id, amount: Number(item?.amount) || 1 }])
  }
  return [...groups.values()].flatMap((rows) => {
    if (rows.length < 2) return []
    const [canonical, ...sources] = [...rows].sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1))
    return sources.map((source) => ({
      kiosk_id: canonical.kiosk_id,
      target_item_id: canonical.id,
      source_item_id: source.id,
    }))
  })
}

/**
 * What the chain ACTUALLY merged, read off the transaction's own `item::ItemMerged` events (or the wrapper's
 * equivalent `extract::StacksMerged` event). The bag folds from THIS, never from the plan: a partially-applied
 * batch, a re-ordered fold or an amount the client mispredicted all resolve to the receipt's truth.
 * @param {{ events?: any[] } | null | undefined} receipt  the normalized run_tx result
 * @returns {{ into: string, from: string, total: number }[]}
 */
export function stack_merge_receipt_rows(receipt) {
  const events = receipt?.events ?? []
  // item::merge emits ItemMerged and the custody wrapper emits StacksMerged for the SAME deletion. Prefer the
  // item event; use the wrapper event only as a compatibility fallback so one merge never folds twice.
  const item_events = events.filter((event) => String(event?.type ?? '').endsWith('::item::ItemMerged'))
  return (item_events.length ? item_events : events).flatMap((event) => {
    const type = String(event?.type ?? '')
    const item_event = type.endsWith('::item::ItemMerged')
    const extract_event = type.endsWith('::extract::StacksMerged')
    if (!item_event && !extract_event) return []
    const merged = event?.parsedJson ?? {}
    const into = String(merged.into ?? merged.target ?? '')
    const from = String(merged.from ?? merged.source ?? '')
    const total = Number(merged.total ?? 0)
    if (!into || !from || !(total > 0)) return []
    return [{ into, from, total }]
  })
}
