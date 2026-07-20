// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'

import { game_log } from '../core/log.js'
import { get_shop_sales } from '../chain/read_shop_sales'

// THE first-party shop catalog store (/mint AND /shop since S-61) — reads the merged package's `shop::Sale`
// catalog from the RPC read-API (`/v1/shop`, SPEC §14 read layer) via get_shop_sales, REPLACING the retired
// COMPANION-package GraphQL SaleCreated event-replay (S-19a: the pre-indexer seam is now the indexer; S-61
// retired the legacy /shop twin store with it). SWR shape: last-known `sales` paint instantly; `load()`
// revalidates and overwrites. Empty (honest) while the read-API has no sales / is unreachable.

// The enriched Sale row get_shop_sales returns — the shape the /mint TierCard and the /shop catalog render.
export type Sale = {
  id: string
  template_id: string
  price_mist: string
  supply: number
  // Already-claimed units (event-derived, handle_shop) — minted + supply(remaining) reconstructs the ORIGINAL
  // cap for a "N of M remaining" supply bar (read_shop_sales.js's sale_supply_progress).
  minted: number
  infinite: boolean
  treasury: string
  // The shop-owned pause flag: a paused sale renders a GREYED card (never hidden).
  paused?: boolean
  template: {
    name?: string
    item_type?: string
    category?: string
    display?: { image_url?: string; name?: string; description?: string }
  } | null
}

// SHOP-CARD DEDUPE: a template can carry MULTIPLE Sale objects when the
// owner pauses one round and creates a fresh one (the pet boxes went through 3 pause+create rounds) — the raw
// /v1/shop feed intentionally keeps every paused sale (so a card CAN grey instead of vanish), which means a
// naive 1-row-per-sale LISTING renders the same template up to N× (the reported "shop shows 4 copies" bug).
// This is the ONE home for the fix: group by template_id —
//   - a live (unpaused) sale exists for the template → render every LIVE sale, drop every paused sibling
//     (superseded-by-recreate ghosts never render).
//   - zero live sales (a fully discontinued template) → render exactly ONE greyed card. `Sale` carries no
//     created-at field, so "newest" is a deterministic (not truly chronological) tiebreak on `id` — the only
//     stable field available at this layer. Thread a real timestamp through read_shop_sales.js's to_shop_row
//     if true chronological ordering is ever needed here.
// PURE — unit-tested directly (items_shop_chain.test.ts). Deliberately NOT folded into raw `sales`: /mint
// (vault.tsx) and the encyclopedia purchasable-lookup (items_tab.tsx) still read every raw Sale untouched —
// this is a LISTING-view selector, applied by the shop page only.
export function dedupe_shop_sales(sales: Sale[]): Sale[] {
  const by_template = new Map<string, Sale[]>()
  for (const sale of sales) {
    const bucket = by_template.get(sale.template_id)
    if (bucket) bucket.push(sale)
    else by_template.set(sale.template_id, [sale])
  }
  const visible: Sale[] = []
  for (const group of by_template.values()) {
    const live = group.filter((s) => !s.paused)
    if (live.length > 0) visible.push(...live)
    else visible.push([...group].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0])
  }
  return visible
}

// ─── THE ONE-PIPELINE REDUCER (M1 template — CLIENT-INDEPENDENCE law, project CLAUDE.md Principle 6) ──────────
// Folds load + apply_purchase into ONE pure reducer so a stale snapshot can never bounce the supply bar (race #7).
// The client PREDICTS its own buy into a pending ledger keyed by real sale id; the version is each Sale's `minted`
// (a monotonic purchase counter); `floor[id]` is the minted a snapshot must reach to PROVE our buys. Merge law:
// minted ≥ floor → adopt chain, drain the pending it proves; minted < floor → stale, hold the decrement (no
// regress); same-version supply mismatch → adopt + flag a divergence (logged at the edge, never inside the core).
// Rollback is a `receipt_failed` input that re-derives from the snapshot base — never a stored pre-tx snapshot.

export type ShopInput =
  | { type: 'snapshot'; sales: Sale[] } // rpc load result — each row versioned by its `minted`
  | { type: 'receipt'; sale_id: string; units?: number } // own buy succeeded — optimistic −units, raise the floor
  | { type: 'receipt_failed'; sale_id: string; units?: number } // own buy failed — drain the pending row, re-derive

export type ShopState = {
  sales: Sale[] // PROJECTED render rows (raw ⊕ pending) — the API-compatible selector components read
  raw: Sale[] // last rpc snapshot — the reconcile base (internal)
  pending: Record<string, number> // per-sale optimistic units a snapshot has not yet reflected
  floor: Record<string, number> // per-sale proven `minted` watermark (the monotonic version floor)
  loaded_once: boolean
}

export type ShopDivergence = { sale_id: string; predicted: number; snapshot: number; version: number } | null

export const empty_shop_state = (): ShopState => ({ sales: [], raw: [], pending: {}, floor: {}, loaded_once: false })

// Project raw snapshot rows through the pending ledger → render rows (finite sales only; infinite has no bar).
function project(raw: Sale[], pending: Record<string, number>): Sale[] {
  if (Object.keys(pending).length === 0) return raw
  return raw.map((s) => {
    const units = pending[s.id] ?? 0
    if (units <= 0 || s.infinite) return s
    return { ...s, supply: Math.max(0, s.supply - units), minted: (s.minted ?? 0) + units }
  })
}

export function reduce(state: ShopState, input: ShopInput): { state: ShopState; divergence: ShopDivergence } {
  switch (input.type) {
    // Own buy landed: predict the decrement into the pending ledger, and raise the floor to the `minted` the chain
    // must reach before a snapshot may drop this row (base minted + all our units for this sale).
    case 'receipt': {
      const units = input.units ?? 1
      const base = state.raw.find((s) => s.id === input.sale_id)
      if (!base || base.infinite) return { state, divergence: null }
      const pending = { ...state.pending, [input.sale_id]: (state.pending[input.sale_id] ?? 0) + units }
      const floor = { ...state.floor, [input.sale_id]: (base.minted ?? 0) + pending[input.sale_id] }
      return { state: { ...state, pending, floor, sales: project(state.raw, pending) }, divergence: null }
    }

    // Own buy failed after painting: drain the pending units and RE-DERIVE from the current snapshot base — never a
    // stored pre-tx snapshot. Floor is released only when the last pending unit for the sale drains.
    case 'receipt_failed': {
      const held = state.pending[input.sale_id] ?? 0
      if (held <= 0) return { state, divergence: null }
      const next = held - (input.units ?? 1)
      const pending = { ...state.pending }
      const floor = { ...state.floor }
      if (next > 0) pending[input.sale_id] = next
      else {
        delete pending[input.sale_id]
        delete floor[input.sale_id]
      }
      return { state: { ...state, pending, floor, sales: project(state.raw, pending) }, divergence: null }
    }

    // rpc snapshot: reconcile each PENDING row against the snapshot's `minted`. minted ≥ floor (or the sale dropped
    // from the feed — sold-out-hidden/gone) → drain, chain wins; minted < floor → STALE, hold the optimistic
    // decrement (no bounce). A same-version supply mismatch is adopted and flagged. Non-pending sales adopt directly.
    case 'snapshot': {
      const by_id = new Map(input.sales.map((r) => [r.id, r]))
      const pending: Record<string, number> = {}
      const floor: Record<string, number> = {}
      let divergence: ShopDivergence = null
      for (const [id, units] of Object.entries(state.pending)) {
        const snap = by_id.get(id)
        const fl = state.floor[id] ?? 0
        if (!snap || (snap.minted ?? 0) >= fl) {
          if (snap && (snap.minted ?? 0) === fl) {
            const predicted = state.sales.find((s) => s.id === id)
            if (predicted && predicted.supply !== snap.supply)
              divergence = { sale_id: id, predicted: predicted.supply, snapshot: snap.supply, version: fl }
          }
          continue // proven by chain (or gone from the feed) — self-drain
        }
        pending[id] = units // stale snapshot — keep the optimistic decrement
        floor[id] = fl
      }
      return {
        state: { ...state, raw: input.sales, pending, floor, sales: project(input.sales, pending), loaded_once: true },
        divergence,
      }
    }

    default:
      return { state, divergence: null }
  }
}

interface ItemsShopStore extends ShopState {
  loading: boolean
  load: () => Promise<void>
  apply_purchase: (sale_id: string) => void
}

export const use_items_shop_chain = create<ItemsShopStore>((set, get) => ({
  ...empty_shop_state(),
  loading: false,

  load: async () => {
    // IN-FLIGHT LATCH (no auto-refire storm) — a mount / StrictMode double-fire / post-buy refresh must
    // not overlap-refire the read. One load at a time; a transport failure surfaces as honest-empty (get_shop_sales
    // swallows) and never drops the pending ledger. The async result DISPATCHES a snapshot input — it never set()s
    // sales directly (ONE-PIPELINE law): the reducer's merge rule decides state, this only commits its output.
    if (get().loading) return
    set({ loading: true })
    try {
      const rows = (await get_shop_sales()) as Sale[]
      const { state, divergence } = reduce(get(), { type: 'snapshot', sales: rows })
      if (divergence)
        game_log('shop', 'supply divergence — predicted ≠ chain at same version (adopting chain)', divergence)
      set({ ...state, loading: false })
    } catch {
      set({ loading: false, loaded_once: true })
    }
  },

  // Optimistic: a finite sale's REMAINING drops (and MINTED rises) the instant a buy lands, held by the
  // pending ledger until a snapshot proves it — dispatched as a `receipt`, reconciled by reduce, never a raw set().
  apply_purchase: (sale_id) => set((s) => reduce(s, { type: 'receipt', sale_id }).state),
}))
