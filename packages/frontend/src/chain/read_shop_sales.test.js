// Pure-function tests for read_shop_sales.js — to_shop_row (RPC sale -> Sale mapping) and sale_supply_progress
// (the shop/vault "N of M remaining" supply-bar math). No React, no RPC, no chain.
import { describe, test, expect } from 'bun:test'

import { to_shop_row, sale_supply_progress } from './read_shop_sales'

const rpc_sale = (over = {}) => ({
  sale_id: '0xsale',
  template_id: '0xtpl',
  price_mist: '1000000000',
  supply_remaining: 70,
  paused: false,
  minted: 30,
  ...over,
})

describe('to_shop_row — pure RPC-sale -> Sale mapping', () => {
  test('threads minted through untouched', () => {
    const row = to_shop_row(rpc_sale({ minted: 30 }), { category: 'hat' })
    expect(row.minted).toBe(30)
  })

  test('a missing minted field on the RPC row defaults to 0 (never NaN/undefined)', () => {
    const row = to_shop_row(rpc_sale({ minted: undefined }), null)
    expect(row.minted).toBe(0)
  })

  test('an infinite sale (supply_remaining null) reports supply 0 / infinite true', () => {
    const row = to_shop_row(rpc_sale({ supply_remaining: null }), null)
    expect(row.infinite).toBe(true)
    expect(row.supply).toBe(0)
  })

  test('category resolves from the encyclopedia enrichment, uppercased', () => {
    const row = to_shop_row(rpc_sale(), { category: 'hat', item_type: 'bronze_sword' })
    expect(row.template.display.image_url).toBeUndefined()
    expect(row.template.category).toBe('HAT')
  })

  test('an unresolved template (encyclopedia miss) falls back to RESOURCE, never CONSUMABLE', () => {
    const row = to_shop_row(rpc_sale(), null)
    expect(row.template.category).toBe('RESOURCE')
  })
})

describe('sale_supply_progress — the shop/vault supply-bar math', () => {
  test('30 minted of a 100 cap (70 remaining) is 30%', () => {
    expect(sale_supply_progress({ infinite: false, supply: 70, minted: 30 })).toEqual({
      minted: 30,
      supply_cap: 100,
      percent_minted: 30,
    })
  })

  test('sold out (0 remaining) is 100%, never over', () => {
    const p = sale_supply_progress({ infinite: false, supply: 0, minted: 250 })
    expect(p.percent_minted).toBe(100)
    expect(p.supply_cap).toBe(250)
  })

  test('nothing minted yet is 0%, never NaN', () => {
    const p = sale_supply_progress({ infinite: false, supply: 500, minted: 0 })
    expect(p.percent_minted).toBe(0)
  })

  test('a missing minted field defaults to 0 (never NaN)', () => {
    const p = sale_supply_progress({ infinite: false, supply: 10 })
    expect(p.minted).toBe(0)
    expect(p.supply_cap).toBe(10)
  })

  test('an infinite sale has no cap / no percent — the card renders no bar', () => {
    const p = sale_supply_progress({ infinite: true, supply: 0, minted: 12 })
    expect(p.supply_cap).toBeNull()
    expect(p.percent_minted).toBeNull()
    expect(p.minted).toBe(12) // minted is still honest data even without a cap to show
  })

  test('matches the vault.tsx TierCard cap formula (minted + remaining)', () => {
    // vault.tsx: cap: s.infinite ? null : minted + Math.max(0, s.supply)
    const p = sale_supply_progress({ infinite: false, supply: 63, minted: 7 })
    expect(p.supply_cap).toBe(70)
  })
})
