// SEED-MANIFEST RECEIPT ↔ LIVING-CORPUS FENCE (SHOP TRIO (a), found 2026-07-17).
// The frontend drops every /v1 shop sale whose template id is absent from the seed-manifest receipt:
// read_shop_sales.js:89 → living_corpus.ts is_living_item → Object.values(seed_manifest.items). The
// 2026-07-16 shop reauthor ceremony (apply_shop_payload.mjs + box_reauthor.mjs) burned the old sales and
// minted FRESH templates without writing the fresh ids back — 5 live sales (3 pet boxes + 2 cloaks)
// became invisible in the shop while remaining fully buyable on-chain. These tests pin BOTH halves:
//   1. the fence MECHANISM — a manifest-absent template id is dropped, a manifest id passes;
//   2. the receipt's FRESHNESS — every live first-party sale (fixtures/live_shop_sales.json, a dated
//      /v1 capture) survives the fence. Red whenever a ceremony mints without maintaining the receipt.
// The fence import is the REAL frontend chain (living_corpus.ts reads the one manifest home through
// content/seed_manifest.ts), so this red is the exact drop the shop UI performs — no re-implementation.
// Fixture refresh after any legitimate reauthor: re-run the join described in the fixture's _source.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

import { is_living_item } from '../../frontend/src/pages/encyclopedia/living_corpus'

const script_dir = dirname(fileURLToPath(import.meta.url))
const live = JSON.parse(
  readFileSync(join(script_dir, 'fixtures', 'live_shop_sales.json'), 'utf8')
)
const seed_manifest = JSON.parse(
  readFileSync(join(script_dir, 'out', 'seed_manifest.json'), 'utf8')
)

test('fence mechanism: a sale whose template id is absent from the manifest receipt is dropped', () => {
  const [living_id] = Object.values(seed_manifest.items)
  expect(is_living_item({ template_id: living_id })).toBe(true)
  expect(is_living_item({ template_id: `0x${'42'.repeat(32)}` })).toBe(false)
})

test('receipt freshness: every live first-party sale survives the living-corpus fence', () => {
  expect(live.sales.length).toBeGreaterThan(0)
  const dropped = live.sales
    .filter((sale) => !is_living_item({ template_id: sale.template_id }))
    .map(
      (sale) => `${sale.item_type} "${sale.name}" template=${sale.template_id}`
    )
  expect(dropped).toEqual([])
})
