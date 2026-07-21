// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LIVING-generation filter (burial-reseed ghost fence, 2026-07-13 — PART 2b, id-keyed). Multiple on-chain
// template generations share this testnet lineage (historic seed trains + the pre-purge 22:55 corpus), and
// /v1's encyclopedia honestly lists every template ever minted. The wiki must show ONLY the living
// generation: each /v1 row's template_id is checked against the CURRENT seed manifest's ids.
// Ids supersede the PART 2a name join: two generations can share a NAME (101 measured dup-names), but a
// template id belongs to exactly one generation. Chain purists: the ghosts still exist on-chain; they are
// harmless orphans, merely unlisted.
//
// Applied to the encyclopedia (wiki) AND — since the 2026-07-13 ghost-sales kill — to first-party SHOP Sales:
// the 41 pre-purge ghost Sales (their item template absent from this whitelist) were `shop::set_paused` on-chain
// (buy/buy_many now abort ESalePaused — UNBUYABLE), so filtering them from the /shop catalog no longer "lies
// about what a buyer can actually buy" — it hides a dead, un-purchasable orphan. The pause is the load-bearing
// money fix; this read filter is the honest UX (read_shop_sales.js consumes is_living_item). STILL NOT applied
// to marketplace listings or pools: those are live player-owned objects a buyer really can transact.
import { is_object_id, seed_manifest } from '../../content/seed_manifest'

const living_item_ids = Object.values(seed_manifest.items).filter(is_object_id)
const living_mob_ids = Object.values(seed_manifest.mobs)
  .map(({ id }) => id)
  .filter(is_object_id)
const living_world_ids = seed_manifest.worlds.map(({ id }) => id).filter(is_object_id)

// DEGRADE LOUDLY (never crash boot) when the seed manifest is absent — the deployment pin is a runtime
// artifact (issue #106 cascade; full runtime conversion is boarded via the inventory). The living-content
// fence goes inert (every is_living_* → false, the shop shows nothing as buyable); the app still mounts.
if (!living_item_ids.length || !living_mob_ids.length || !living_world_ids.length)
  console.error(
    `[living_corpus] seed manifest carries ${living_item_ids.length} item / ${living_mob_ids.length} mob / ` +
      `${living_world_ids.length} world ids — the living-content fence is inert until the seed manifest ships (issue #106).`
  )

const living_item_ids_set = new Set(living_item_ids)
const living_mob_ids_set = new Set(living_mob_ids)
const living_world_ids_set = new Set(living_world_ids)

export const is_living_item = (row: { template_id?: string | null }) => living_item_ids_set.has(row.template_id ?? '')

export const is_living_mob = (row: { template_id?: string | null }) => living_mob_ids_set.has(row.template_id ?? '')

export const is_living_world = (row: { world_id?: string | null }) => living_world_ids_set.has(row.world_id ?? '')
