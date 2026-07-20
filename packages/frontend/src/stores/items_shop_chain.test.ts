// dedupe_shop_sales — pure unit tests (items_shop_chain.ts). No React, no RPC, no chain: covers the
// owner-adjudicated shop-listing rule that killed the "same item renders up to 4x" bug (superseded paused
// sales from pause+recreate rounds rendering beside the live one).
import { describe, test, expect } from 'bun:test'

import { dedupe_shop_sales, reduce, empty_shop_state, type Sale, type ShopState } from './items_shop_chain'

const sale = (over: Partial<Sale> & { id: string; template_id: string }): Sale => ({
  price_mist: '1000000000',
  supply: 10,
  minted: 0,
  infinite: false,
  treasury: '',
  paused: false,
  template: null,
  ...over,
})

describe('dedupe_shop_sales — live supersedes paused', () => {
  test('a live sale + 3 paused siblings of the same template renders only the live sale', () => {
    const sales = [
      sale({ id: 'paused-1', template_id: 'pet_box', paused: true }),
      sale({ id: 'paused-2', template_id: 'pet_box', paused: true }),
      sale({ id: 'live', template_id: 'pet_box', paused: false }),
      sale({ id: 'paused-3', template_id: 'pet_box', paused: true }),
    ]
    const visible = dedupe_shop_sales(sales)
    expect(visible).toHaveLength(1)
    expect(visible[0].id).toBe('live')
  })

  test('multiple concurrent LIVE sales for one template are all kept (never arbitrarily collapsed)', () => {
    const sales = [
      sale({ id: 'live-a', template_id: 'double_live', paused: false }),
      sale({ id: 'live-b', template_id: 'double_live', paused: false }),
    ]
    expect(dedupe_shop_sales(sales)).toHaveLength(2)
  })
})

describe('dedupe_shop_sales — fully discontinued (only paused)', () => {
  test('a template with only paused sales renders exactly one greyed card', () => {
    const sales = [
      sale({ id: 'round-1', template_id: 'discontinued_hat', paused: true }),
      sale({ id: 'round-2', template_id: 'discontinued_hat', paused: true }),
      sale({ id: 'round-3', template_id: 'discontinued_hat', paused: true }),
    ]
    const visible = dedupe_shop_sales(sales)
    expect(visible).toHaveLength(1)
    expect(visible[0].paused).toBe(true)
    // No created-at field survives to this layer — the tiebreak is a deterministic (not chronological) sort on
    // `id`; pinned here so a future refactor can't silently flip which round wins without failing a test.
    expect(visible[0].id).toBe('round-3')
  })

  test('a single paused sale (no live sibling) still renders — paused is greyed, never hidden', () => {
    const sales = [sale({ id: 'lone-paused', template_id: 'retired_cloak', paused: true })]
    expect(dedupe_shop_sales(sales)).toEqual(sales)
  })
})

describe('dedupe_shop_sales — unaffected templates + scale', () => {
  test('42 single-sale templates pass through untouched; the 6 multi-sale templates collapse to one card each', () => {
    const single_sale_templates = Array.from({ length: 42 }, (_, i) =>
      sale({ id: `single-${i}`, template_id: `template-${i}`, paused: false })
    )
    const multi_sale_templates = Array.from({ length: 6 }, (_, i) => [
      sale({ id: `multi-${i}-paused-1`, template_id: `multi-template-${i}`, paused: true }),
      sale({ id: `multi-${i}-paused-2`, template_id: `multi-template-${i}`, paused: true }),
      sale({ id: `multi-${i}-live`, template_id: `multi-template-${i}`, paused: false }),
    ]).flat()

    const all_sales = [...single_sale_templates, ...multi_sale_templates]
    expect(all_sales).toHaveLength(42 + 18) // 42 + 6*3 paused-round rows

    const visible = dedupe_shop_sales(all_sales)
    expect(visible).toHaveLength(48) // 42 untouched + 6 collapsed to their one live sale each
    for (let i = 0; i < 42; i++) expect(visible.some((s) => s.id === `single-${i}`)).toBe(true)
    for (let i = 0; i < 6; i++) {
      expect(visible.some((s) => s.id === `multi-${i}-live`)).toBe(true)
      expect(visible.some((s) => s.id === `multi-${i}-paused-1` || s.id === `multi-${i}-paused-2`)).toBe(false)
    }
  })

  test('empty input is honestly empty', () => {
    expect(dedupe_shop_sales([])).toEqual([])
  })
})

// ─── THE ONE-PIPELINE REDUCER (M1 template) — the three doctrine reds for race row #7 ───────────────────────────
const row = (st: ShopState, id: string) => st.sales.find((s) => s.id === id)!
const snap = (sales: Sale[]) => ({ type: 'snapshot' as const, sales })

describe('reduce — supply race (row #7): a stale snapshot must never bounce the bar back up', () => {
  test('RED #1: an optimistic buy holds through an indexer-lagged snapshot that omits the purchase', () => {
    let st = empty_shop_state()
    st = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 10, minted: 0 })])).state
    st = reduce(st, { type: 'receipt', sale_id: 'X' }).state
    expect(row(st, 'X').supply).toBe(9) // optimistic paint
    // the reported bug: a STALE wholesale snapshot (indexer hasn't projected the buy) arrives
    st = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 10, minted: 0 })])).state
    expect(row(st, 'X').supply).toBe(9) // held by the pending ledger — NOT bounced to 10
    expect(row(st, 'X').minted).toBe(1)
  })

  test('the pending row self-drains once a snapshot INCLUDES the purchase (minted reached the floor)', () => {
    let st = empty_shop_state()
    st = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 10, minted: 0 })])).state
    st = reduce(st, { type: 'receipt', sale_id: 'X' }).state
    st = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 9, minted: 1 })])).state // chain caught up
    expect(row(st, 'X').supply).toBe(9)
    expect(st.pending.X ?? 0).toBe(0) // drained
  })
})

describe('reduce — receipt_failed rolls back by re-deriving (never a stored snapshot)', () => {
  test('RED #2: a failed buy restores the current snapshot base, not a stale pre-tx snapshot', () => {
    let st = empty_shop_state()
    st = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 10, minted: 0 })])).state
    st = reduce(st, { type: 'receipt', sale_id: 'X' }).state
    expect(row(st, 'X').supply).toBe(9)
    st = reduce(st, { type: 'receipt_failed', sale_id: 'X' }).state
    expect(row(st, 'X').supply).toBe(10) // re-derived from raw
    expect(st.pending.X ?? 0).toBe(0)
  })
})

describe('reduce — divergence: predicted ≠ snapshot at the same version adopts chain + flags it', () => {
  test('RED #3: a same-minted snapshot with a different supply is adopted and reported', () => {
    let st = empty_shop_state()
    st = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 10, minted: 0 })])).state
    st = reduce(st, { type: 'receipt', sale_id: 'X' }).state // predict supply 9 at minted 1
    const out = reduce(st, snap([sale({ id: 'X', template_id: 't', supply: 8, minted: 1 })]))
    expect(out.divergence).not.toBeNull()
    expect(out.divergence?.snapshot).toBe(8)
    expect(row(out.state, 'X').supply).toBe(8) // chain adopted
  })
})
