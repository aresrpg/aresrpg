// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// reduce — pure unit tests (marketplace_chain.ts). No React, no RPC, no chain: covers CLIENT_DESIGN_AUDIT.md
// row #2 — the wholesale `set({listings})` clobber of optimistic list/delist/buy rows, and the stale-rollback
// that restored a captured pre-tx value instead of re-deriving. House convention bans mock.module — the reducer
// is pure, so it's tested directly with plain fixtures (mirrors items_shop_chain.test.ts, the M1 template).
import { afterAll, describe, test, expect } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import type { MarketplaceListing } from '../types/chain'

import type { MarketState } from './marketplace_chain'

// marketplace_chain.ts transitively imports ../auth, which registers Enoki wallets at module-load time and
// unconditionally touches `window.location` — stub the DOM surface FIRST (house pattern: browser_globals.js,
// the same idiom embed_voxel_fight_camera.test.js uses for its own window-touching module under bun test).
const restore_browser_globals = install_browser_globals()
const { use_auth } = await import('../auth')
const { reduce, empty_market_state, use_marketplace_chain } = await import('./marketplace_chain')
afterAll(restore_browser_globals)

const listing = (over: Partial<MarketplaceListing> & { id: string; price_mist: string }): MarketplaceListing =>
  ({
    seller_uuid: '',
    seller_sui_address: '',
    seller_name: '',
    price: 0,
    item: { id: over.id },
    ...over,
  }) as unknown as MarketplaceListing

const snap = (listings: MarketplaceListing[]) => ({ type: 'snapshot' as const, listings })
const ids = (st: MarketState) => st.listings.map((l) => l.id)
const row = (st: MarketState, id: string) => st.listings.find((l) => l.id === id)

// ─── clobber (row #2): own optimistic LIST must survive a stale wholesale snapshot ────────────────────────────
describe('reduce — clobber: own optimistic LIST holds through a stale wholesale snapshot', () => {
  test('RED #1: a fresh list holds through a concurrent snapshot that omits it (indexer lag)', () => {
    let st = empty_market_state()
    st = reduce(st, snap([listing({ id: 'other', price_mist: '500' })])).state
    st = reduce(st, { type: 'receipt', kind: 'list', listing: listing({ id: 'mine', price_mist: '700' }) }).state
    expect(ids(st)).toContain('mine') // optimistic paint
    // the reported bug: a wholesale snapshot lands before the indexer has projected our list
    st = reduce(st, snap([listing({ id: 'other', price_mist: '500' })])).state
    expect(ids(st)).toContain('mine') // held — NOT clobbered by the wholesale snapshot
    expect(ids(st)).toContain('other') // the concurrent load's own data is still honored
  })

  test('the pending row self-drains once a snapshot INCLUDES the listing (list proven)', () => {
    let st = empty_market_state()
    st = reduce(st, { type: 'receipt', kind: 'list', listing: listing({ id: 'mine', price_mist: '700' }) }).state
    st = reduce(st, snap([listing({ id: 'mine', price_mist: '700' })])).state // chain caught up
    expect(ids(st)).toEqual(['mine'])
    expect(st.pending.mine).toBeUndefined() // drained — raw carries it now, no synthetic duplicate
  })
})

// ─── own DELIST/BUY hold hidden through indexer lag, symmetric to the list case ───────────────────────────────
describe('reduce — own DELIST/BUY hold hidden through a lagging snapshot, drain once proven gone', () => {
  test('a pending delist stays hidden while the snapshot still lags (has not caught up)', () => {
    let st = empty_market_state()
    st = reduce(st, snap([listing({ id: 'X', price_mist: '100' })])).state
    st = reduce(st, { type: 'receipt', kind: 'delist', listing_id: 'X' }).state
    expect(ids(st)).toEqual([])
    st = reduce(st, snap([listing({ id: 'X', price_mist: '100' })])).state // lagging snapshot still shows it
    expect(ids(st)).toEqual([]) // held hidden, not bounced back
    expect(st.pending.X).toBeDefined()
  })

  test('a pending buy drains once the snapshot no longer carries the id (sale proven)', () => {
    let st = empty_market_state()
    st = reduce(st, snap([listing({ id: 'Y', price_mist: '300' })])).state
    st = reduce(st, { type: 'receipt', kind: 'buy', listing_id: 'Y' }).state
    expect(ids(st)).toEqual([])
    st = reduce(st, snap([])).state // chain caught up — the listing is gone
    expect(ids(st)).toEqual([])
    expect(st.pending.Y).toBeUndefined() // drained
  })
})

// ─── receipt_failed rolls back by re-deriving from CURRENT raw — never a stored pre-tx value ──────────────────
describe('reduce — receipt_failed re-derives from raw (never a stored pre-tx snapshot)', () => {
  test('RED #2: a failed delist restores straight from the current raw, not a captured value', () => {
    let st = empty_market_state()
    st = reduce(st, snap([listing({ id: 'X', price_mist: '100' })])).state
    st = reduce(st, { type: 'receipt', kind: 'delist', listing_id: 'X' }).state
    expect(ids(st)).toEqual([]) // hidden instantly
    st = reduce(st, { type: 'receipt_failed', listing_id: 'X' }).state
    expect(ids(st)).toEqual(['X']) // re-derived from raw
  })

  test('a failed delist never resurrects a listing a concurrent snapshot already proved gone', () => {
    let st = empty_market_state()
    st = reduce(st, snap([listing({ id: 'X', price_mist: '100' })])).state
    st = reduce(st, { type: 'receipt', kind: 'delist', listing_id: 'X' }).state
    // WHILE our delist is in flight, someone else buys X first — the next snapshot legitimately excludes it
    st = reduce(st, snap([])).state
    expect(ids(st)).toEqual([])
    // our delist tx now fails (X was already gone on-chain)
    st = reduce(st, { type: 'receipt_failed', listing_id: 'X' }).state
    expect(ids(st)).toEqual([]) // re-derived from CURRENT raw — X stays gone, never resurrected
  })

  test('a failed list clears the synthetic row — it never existed on chain, nothing to restore', () => {
    let st = empty_market_state()
    st = reduce(st, { type: 'receipt', kind: 'list', listing: listing({ id: 'mine', price_mist: '700' }) }).state
    expect(ids(st)).toEqual(['mine'])
    st = reduce(st, { type: 'receipt_failed', listing_id: 'mine' }).state
    expect(ids(st)).toEqual([])
  })

  test('a failed buy restores the listing straight from raw, symmetric to delist', () => {
    let st = empty_market_state()
    st = reduce(st, snap([listing({ id: 'Y', price_mist: '300' })])).state
    st = reduce(st, { type: 'receipt', kind: 'buy', listing_id: 'Y' }).state
    expect(ids(st)).toEqual([])
    st = reduce(st, { type: 'receipt_failed', listing_id: 'Y' }).state
    expect(ids(st)).toEqual(['Y'])
  })
})

// ─── divergence: predicted vs snapshot content mismatch at the proof edge adopts chain + flags it ─────────────
describe('reduce — divergence: a list proven at a different price than predicted adopts chain + flags it', () => {
  test('RED #3: a listing proven at a different price than predicted is adopted and reported', () => {
    let st = empty_market_state()
    st = reduce(st, { type: 'receipt', kind: 'list', listing: listing({ id: 'X', price_mist: '700' }) }).state
    const out = reduce(st, snap([listing({ id: 'X', price_mist: '650' })])) // chain proves it at a different price
    expect(out.divergence).not.toBeNull()
    expect(out.divergence?.snapshot_price_mist).toBe('650')
    expect(row(out.state, 'X')?.price_mist).toBe('650') // chain adopted
  })

  test('a matching price at proof time is silent — no divergence', () => {
    let st = empty_market_state()
    st = reduce(st, { type: 'receipt', kind: 'list', listing: listing({ id: 'X', price_mist: '700' }) }).state
    const out = reduce(st, snap([listing({ id: 'X', price_mist: '700' })]))
    expect(out.divergence).toBeNull()
  })
})

// ─── plain pass-through / initial state sanity ─────────────────────────────────────────────────────────────
describe('reduce — non-pending rows and empty state', () => {
  test('a snapshot with no pending rows adopts directly (no ledger overhead)', () => {
    const st = reduce(
      empty_market_state(),
      snap([listing({ id: 'A', price_mist: '1' }), listing({ id: 'B', price_mist: '2' })])
    ).state
    expect(ids(st)).toEqual(['A', 'B'])
    expect(st.pending).toEqual({})
    expect(st.loaded_once).toBe(true)
  })

  test('empty_market_state starts honestly empty', () => {
    const st = empty_market_state()
    expect(st.listings).toEqual([])
    expect(st.loaded_once).toBe(false)
  })
})

describe('marketplace purchase balance precheck', () => {
  test('an insufficient cached balance returns before item or character purchase work starts', () => {
    const previous_auth = use_auth.getState()
    const ask = listing({ id: 'priced', kiosk_id: 'kiosk', price_mist: '1000000000' })
    use_auth.setState({ address: '0xbuyer', sui_balance_mist: 0n })
    use_marketplace_chain.setState({
      ...empty_market_state(),
      raw: [ask],
      listings: [ask],
      busy: false,
    })

    use_marketplace_chain.getState().submit_buy(ask)
    expect(use_marketplace_chain.getState().busy).toBe(false)
    expect(use_marketplace_chain.getState().pending).toEqual({})
    expect(ids(use_marketplace_chain.getState())).toEqual(['priced'])

    use_marketplace_chain
      .getState()
      .submit_buy_character({ item_id: 'character', kiosk_id: 'kiosk', price_mist: '1000000000' })
    expect(use_marketplace_chain.getState().busy).toBe(false)

    use_auth.setState({
      address: previous_auth.address,
      sui_balance_mist: previous_auth.sui_balance_mist,
    })
  })
})
