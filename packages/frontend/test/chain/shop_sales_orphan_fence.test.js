// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ISSUE #1467, the MONEY half. The first-party shop catalog fenced every Sale through the BUILD-TIME seed
// receipt (`is_living_item`): a Sale whose item template was absent from the bundled manifest was hidden as a
// dead pre-purge orphan. The receipt is frozen into the deployed bundle, so one republish outrunning one
// redeploy hid the ENTIRE catalog — nothing buyable, on the only surface that takes money. The same class
// blanked the encyclopedia's DROPPED BY (measured 2026-07-28: 0 of 383 live mob rows survived that join).
//
// The fence survives, resolved against LIVE truth: the /v1 item catalog decides which sales exist. And
// ABSENCE IS NOT EMPTINESS — a failed or empty catalog read is not evidence that a sale is dead, so every
// sale flows through un-fenced rather than the session cacheing a blank shop.
//
// spyOn over the rpc/client namespace (the read_findables.test.js idiom) — never mock.module, which is
// process-global in bun and would leak into every sibling test file.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../../src/rpc/client'

const get_shop = spyOn(rpc_client, 'get_shop')
const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia')

const { get_shop_sales } = await import('../../src/chain/read_shop_sales.js')

const LIVE_TEMPLATE = '0x4d03aa2ec42f016cd8f34af0231e960bce37e40fdb9b5eb1942a83a1744aa4ee'
const ORPHAN_TEMPLATE = '0xa6a4b12ab46d2dd1518f823aeeaac5d48d5e47debd51192606bcd0fc10f63425'

const sale = (template_id, over = {}) => ({
  sale_id: `sale:${template_id}`,
  template_id,
  price_mist: '1000000000',
  supply_remaining: 5,
  paused: false,
  minted: 0,
  ...over,
})

const live_item = (template_id) => ({ template_id, name: 'Wooling Fleece', item_type: 'fleece', category: 'resource' })

beforeEach(() => {
  get_shop.mockReset()
  get_encyclopedia.mockReset()
})
afterEach(() => {
  get_shop.mockReset()
  get_encyclopedia.mockReset()
})
afterAll(() => {
  get_shop.mockRestore()
  get_encyclopedia.mockRestore()
})

describe('get_shop_sales — the orphan fence resolves against the live catalog', () => {
  test('a sale whose template the live catalog serves is buyable, and is enriched from it', async () => {
    get_shop.mockImplementation(async () => [sale(LIVE_TEMPLATE)])
    get_encyclopedia.mockImplementation(async (kind) => {
      expect(kind).toBe('items')
      return { items: [live_item(LIVE_TEMPLATE)] }
    })

    const rows = await get_shop_sales()
    expect(rows.map((row) => row.template_id)).toEqual([LIVE_TEMPLATE])
    expect(rows[0].template.name).toBe('Wooling Fleece')
  })

  test('a sale whose template the live catalog does NOT serve is a dead orphan and is hidden', async () => {
    get_shop.mockImplementation(async () => [sale(LIVE_TEMPLATE), sale(ORPHAN_TEMPLATE)])
    get_encyclopedia.mockImplementation(async () => ({ items: [live_item(LIVE_TEMPLATE)] }))

    expect((await get_shop_sales()).map((row) => row.template_id)).toEqual([LIVE_TEMPLATE])
  })

  // THE CLASS. Under the old build-time fence these two cases were the catastrophe: a catalog the client
  // could not read looked exactly like a catalog with nothing in it.
  test('a FAILED catalog read never empties the shop — every sale flows through un-fenced', async () => {
    get_shop.mockImplementation(async () => [sale(LIVE_TEMPLATE), sale(ORPHAN_TEMPLATE)])
    get_encyclopedia.mockImplementation(async () => {
      throw new Error('read API unreachable')
    })

    const rows = await get_shop_sales()
    expect(rows.map((row) => row.template_id).sort()).toEqual([ORPHAN_TEMPLATE, LIVE_TEMPLATE].sort())
    // Unenriched cards fall back to the id/slug, never a fabricated name.
    expect(rows[0].template.name).toBe(rows[0].template_id)
  })

  test('an EMPTY catalog read never empties the shop either — absence is not emptiness', async () => {
    get_shop.mockImplementation(async () => [sale(LIVE_TEMPLATE)])
    get_encyclopedia.mockImplementation(async () => ({ items: [] }))

    expect((await get_shop_sales()).map((row) => row.template_id)).toEqual([LIVE_TEMPLATE])
  })

  test('an unreachable shop read is an honest empty, never a fabricated catalog', async () => {
    get_shop.mockImplementation(async () => {
      throw new Error('read API unreachable')
    })
    expect(await get_shop_sales()).toEqual([])
  })

  test('a paused sale still renders (greyed card); a cold sold-out finite one does not', async () => {
    get_shop.mockImplementation(async () => [
      sale(LIVE_TEMPLATE, { paused: true }),
      sale(ORPHAN_TEMPLATE, { supply_remaining: 0 }),
    ])
    get_encyclopedia.mockImplementation(async () => ({
      items: [live_item(LIVE_TEMPLATE), live_item(ORPHAN_TEMPLATE)],
    }))

    expect((await get_shop_sales()).map((row) => row.template_id)).toEqual([LIVE_TEMPLATE])
  })
})
