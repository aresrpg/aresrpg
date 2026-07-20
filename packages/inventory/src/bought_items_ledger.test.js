// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit coverage of the optimistic bought-item ledger (the ADDITION twin of the consumable delta ledger).
// Proves the fix's bar: a just-bought row survives a chain reconcile that DOESN'T yet include it (indexer
// lag), then SELF-DRAINS the instant a reconcile does include its id (the authoritative row takes over, no
// duplicate). An empty ledger is a pass-through (no cost on the common path).
import { beforeEach, describe, expect, it } from 'bun:test'

import { add_pending_buy, drop_pending_buy, merge_pending_buys, reset_pending_buys } from './bought_items_ledger.js'

const KEY = { id: '0xkey', item_type: 'dungeon_key', item_category: 'key', amount: 1 }

beforeEach(() => reset_pending_buys())

describe('bought-item ledger', () => {
  it('passes a chain bag through untouched when nothing is pending (same ref)', () => {
    const chain = [{ id: '0xa' }, { id: '0xb' }]
    expect(merge_pending_buys(chain)).toBe(chain)
  })

  it('injects a pending buy the indexer-lagged reconcile does NOT yet include', () => {
    add_pending_buy(KEY)
    const lagged = [{ id: '0xa' }] // /v1 has not projected the buy yet
    const merged = merge_pending_buys(lagged)
    expect(merged).toHaveLength(2)
    expect(merged.find((i) => i.id === '0xkey')).toEqual(KEY)
  })

  it('survives repeated lagged reconciles until the chain catches up', () => {
    add_pending_buy(KEY)
    // three reconciles land before the indexer projects it — the row stays every time
    for (let i = 0; i < 3; i += 1) expect(merge_pending_buys([{ id: '0xa' }]).some((r) => r.id === '0xkey')).toBe(true)
  })

  it('self-drains the instant a reconcile includes the id — the authoritative row wins, no duplicate', () => {
    add_pending_buy(KEY)
    // the indexer now returns the REAL row for the same id (authoritative amount/kiosk)
    const real = { id: '0xkey', item_type: 'dungeon_key', item_category: 'key', amount: 1, kiosk_id: '0xk' }
    const merged = merge_pending_buys([{ id: '0xa' }, real])
    expect(merged.filter((r) => r.id === '0xkey')).toEqual([real]) // exactly one, and it's the chain row
    // drained: a subsequent lagged read no longer re-injects the optimistic row
    expect(merge_pending_buys([{ id: '0xa' }]).some((r) => r.id === '0xkey')).toBe(false)
  })

  it('manual drop removes a pending buy without a reconcile', () => {
    add_pending_buy(KEY)
    drop_pending_buy('0xkey')
    expect(merge_pending_buys([]).some((r) => r.id === '0xkey')).toBe(false)
  })
})
