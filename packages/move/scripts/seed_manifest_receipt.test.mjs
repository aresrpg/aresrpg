// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cross-publish shop identity regression. Both fixtures are independent captured `/v1` responses:
// `live_shop_sales.json` is the shop view and the frontend encyclopedia fixture is the item-template view.
// They deliberately span a republish: Mo Hood retained its name while its template id changed.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const read_json = (relative_path) => JSON.parse(readFileSync(new URL(relative_path, import.meta.url), 'utf8'))
const { sales } = read_json('./fixtures/live_shop_sales.json')
const { items } = read_json('../../frontend/src/rpc/fixtures/encyclopedia.json')
const name_key = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()

test('captured shop rows converge with the served item view by stable name, not receipt template id', () => {
  const live_ids = new Set(items.map((item) => item.template_id))
  const live_names = new Set(items.map((item) => name_key(item.name)))

  expect(sales.filter((sale) => live_ids.has(sale.template_id))).toHaveLength(36)
  expect(sales.filter((sale) => live_names.has(name_key(sale.name)))).toHaveLength(37)
  expect(sales).toHaveLength(37)
})

test('the frontend shop fence reads current /v1 items and has no seed-receipt resolver', () => {
  const source = readFileSync(new URL('../../frontend/src/chain/read_shop_sales.js', import.meta.url), 'utf8')
  expect(source).toContain("get_encyclopedia('items')")
  expect(source).not.toContain('seed_manifest')
  expect(source).not.toContain('is_living_item')
})
