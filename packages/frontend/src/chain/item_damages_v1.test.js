// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#619 leg 3 — "a longsword with zero damage characteristics"): the authored weapon damage lines
// live on the ItemTemplate's `item_damages::DamagesKey` dynamic field and reach the client through the
// `/v1/encyclopedia` item projection. Every item surface used to join `damages` from the BUILD-TIME seed
// catalog (`virtual:item_catalog`), which resolves EMPTY in this repo's build — so no weapon ever rendered a
// damage line. This pins the CAPTURED WIRE BYTES of a real template's DF so the decode cannot be proven by
// the model that produced it.
//
// PROVENANCE (captured 2026-07-25 via graphql.testnet.sui.io, testnet — ids abbreviated: the hardcoded
// chain-id gate forbids full ids in source, and the WIRE BYTES are what this test pins):
//   package   0x045fdf6f…7180adc9   (the live `aresrpg` deployment)
//   template  0x6cf36929…bcc69e39   ItemTemplate "Practice Longsword" (item_type practice_longsword)
//   DF        `<pkg>::item_damages::DamagesKey` → `vector<<pkg>::item_damages::ItemDamages>`
//   value bcs "ARAAHQAGd2VhcG9uBXdhdGVy"  (01 | 1000 | 1D00 | 06 "weapon" | 05 "water")
import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'

import { item_damages_from_v1 } from './read_findables'

// item_damages.move's `ItemDamages { from: u16, to: u16, damage_type: String, element: String }`, in
// declaration order — the BCS layout the chain actually wrote.
const ItemDamages = bcs.struct('ItemDamages', {
  from: bcs.u16(),
  to: bcs.u16(),
  damage_type: bcs.string(),
  element: bcs.string(),
})

const CAPTURED_DAMAGES_BCS = 'ARAAHQAGd2VhcG9uBXdhdGVy'

test('the captured DamagesKey wire bytes decode to the exact row shape /v1 serves', () => {
  const lines = bcs.vector(ItemDamages).parse(Uint8Array.from(Buffer.from(CAPTURED_DAMAGES_BCS, 'base64')))

  // The indexer projects this struct verbatim (packages/rpc/api/views.js `damages: t.damages ?? []`).
  expect(lines).toEqual([{ from: 16, to: 29, damage_type: 'weapon', element: 'water' }])
})

test('a real weapon template’s /v1 damage lines decode into renderable detail lines', () => {
  const lines = bcs.vector(ItemDamages).parse(Uint8Array.from(Buffer.from(CAPTURED_DAMAGES_BCS, 'base64')))

  // Element is uppercased to the one display convention every damage surface already renders
  // (ELEMENT_COLORS / the seed catalog rows); `damage_type` stays raw — ItemDetailView keys the
  // life_steal label off the chain's own lowercase slug.
  expect(item_damages_from_v1(lines)).toEqual([{ from: 16, to: 29, damage_type: 'weapon', element: 'WATER' }])
})

test('a template with no DamagesKey field (non-weapon) decodes to honest-empty, never a fabricated line', () => {
  expect(item_damages_from_v1(undefined)).toEqual([])
  expect(item_damages_from_v1([])).toEqual([])
})
