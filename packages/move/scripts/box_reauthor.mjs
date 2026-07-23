// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOX REAUTHOR — the `reauthor_boxes` op set consumed by apply_shop_payload.mjs (LB3). The 3 §11 pet loot-box
// templates were seeded WITHOUT the KIND_GACHA_ROLL effect (seed/mainnet/
// pet_boxes.json omitted `gacha:true`), so loot_box.move::is_gacha_box rejects them and open_box aborts
// ENotBox=103 — every purchased box is un-openable. NO contract upgrade: each broken box is
// REAUTHORED. One ATOMIC PTB per box pauses+burns the old sale, creates the CORRECTED template (same
// name/desc/art/price/level, WITH the gacha effect), creates the replacement sale (supply = original cap − old
// minted), and sets the loot table on the FRESH template id — a corrected box with no table still aborts
// ENoTable, so the table is part of the fix, threaded from the create_template result (an ID has `copy`, so it
// feeds create_sale AND admin_set_loot_table in the same PTB).
//
// This lives in a SIBLING module (not inline in apply_shop_payload.mjs) only to keep that ceremony file ≤600
// LoC; apply_shop_payload imports build_box_plan + reauthor_box_tx and runs them inside its ONE DRY_RUN-default,
// no-retry ceremony. PURE — no chain, no client import: inputs are the /v1 live rows, the pet_boxes.json box
// rows, and the seed manifest (POOL PET ids only — the old box ids are PINNED incident facts below; the manifest
// is the ceremony's output receipt, never its input). Outputs a plan + @mysten/sui Transactions. Converged ops
// are omitted from reauthor_boxes (rerun-idempotent) and surface in manifest_receipt for the same-run write-back.

import { Transaction } from '@mysten/sui/transactions'

const sui_to_mist = 1_000_000_000n

// The 3 boxes and their OWNER-LOCKED price/supply (DECISIONS 2026-07-12/13; pet_boxes.json _meta), plus the
// PINNED old (broken) template ids this incident burns. A drifted seed must never silently reprice a live sale,
// so build_box_plan asserts each seed row against these before authoring. The old ids are INCIDENT FACTS pinned
// here — NOT resolved from seed_manifest.json: the manifest is the ceremony's OUTPUT receipt (the living
// generation, maintained by manifest_writeback.mjs), so reading it as "the old id" would burn the corrected
// sale on every rerun the moment the receipt is fresh.
export const box_slugs = [
  'pet_lootbox',
  'pet_ocean_lootbox',
  'pet_arisen_lootbox',
]
export const BOX_APPROVALS = {
  pet_lootbox: {
    price_sui: 25,
    supply: 10000,
    old_template_id:
      '0x4815b02049c3bedbe8399397b49f23eb5712cda4371c8b9058c1ff57950c7f1b',
  },
  pet_ocean_lootbox: {
    price_sui: 60,
    supply: 5000,
    old_template_id:
      '0x0cc38bf9b977cd71aa1daa5fc98557cfcb0b3774e39ea0106e0ac213b5a71758',
  },
  pet_arisen_lootbox: {
    price_sui: 200,
    supply: 1000,
    old_template_id:
      '0x5e5e0890c4e560a4b7b2ab0cce269194d9e2ab2354c2cdc06a2414c15721aed5',
  },
}

function require_id(value, label) {
  if (!/^0x[0-9a-f]{64}$/i.test(value ?? ''))
    throw new Error(`${label}: expected a 0x-64 id, got ${value}`)
  return value
}

function box_index(box_rows) {
  if (!Array.isArray(box_rows))
    throw new Error('pet_boxes.json boxes must be an array')
  const by_slug = new Map()
  for (const row of box_rows) {
    if (!row?.slug) throw new Error('a pet_boxes.json box row is missing slug')
    if (by_slug.has(row.slug)) throw new Error(`duplicate box slug ${row.slug}`)
    by_slug.set(row.slug, row)
  }
  return by_slug
}

// Resolve a box's weighted pool to on-chain pet template ids (from the seed manifest). Every pool pet MUST be
// seeded — a loud throw beats setting a half-broken table (loot_box.move refuses a 0-sum table anyway).
function resolve_pool(box_row, seed_manifest, slug) {
  const items = seed_manifest?.items ?? {}
  const pool = (box_row.pool || []).map((entry) => {
    if (!entry?.pet) throw new Error(`${slug}: a pool entry is missing pet`)
    if (!Number.isSafeInteger(entry.weight) || entry.weight < 0)
      throw new Error(
        `${slug}: pool ${entry.pet} has invalid weight ${entry.weight}`
      )
    return {
      template_id: require_id(
        items[entry.pet],
        `${slug} pool pet ${entry.pet}`
      ),
      weight: entry.weight,
    }
  })
  if (!pool.length) throw new Error(`${slug}: box has an empty pool`)
  if (pool.reduce((sum, entry) => sum + entry.weight, 0) <= 0)
    throw new Error(`${slug}: pool total weight is 0 (nothing could ever roll)`)
  return pool
}

const box_category = (box_row) => String(box_row.category ?? '').toLowerCase()

// A live template matches the CORRECTED box iff its content equals the seed row's. The gacha effect is a DF (NOT
// in this key), so the OLD broken template ALSO matches — the caller disambiguates by template_id (fresh ≠ the
// PINNED old incident id).
function box_template_matches(template, box_row) {
  return (
    template?.name === box_row.name &&
    (template?.description ?? '') === (box_row.description ?? '') &&
    template?.item_type === box_row.itemType &&
    template?.category === box_category(box_row) &&
    template?.level === (box_row.level ?? 1)
  )
}

function sale_for_template(live_rows, template_id, label) {
  const matches = live_rows.filter((row) => row.template_id === template_id)
  if (matches.length > 1)
    throw new Error(
      `${label}: ${matches.length} live sales resolve to template ${template_id}; refusing an ambiguous sale id`
    )
  return matches.at(0) ?? null
}

function require_sale_shape(sale, label) {
  if (typeof sale.sale_id !== 'string' || !sale.sale_id)
    throw new Error(`${label}: live row has no sale_id`)
  if (!Number.isSafeInteger(sale.minted) || sale.minted < 0)
    throw new Error(`${label}: live row has invalid minted=${sale.minted}`)
  if (typeof sale.paused !== 'boolean')
    throw new Error(`${label}: live row has invalid paused=${sale.paused}`)
  return sale
}

function validate_box_seed(box_row, slug) {
  const approval = BOX_APPROVALS[slug]
  if (
    box_row.price_sui !== approval.price_sui ||
    box_row.supply !== approval.supply
  )
    throw new Error(
      `${slug}: corrected seed price/supply drifted from owner approval (${approval.price_sui} SUI × ${approval.supply})`
    )
  if (box_row.itemType !== slug || box_category(box_row) !== 'consumable')
    throw new Error(
      `${slug}: corrected seed must author the consumable box (itemType=${slug}, category=consumable)`
    )
  if (!box_row.gacha)
    throw new Error(
      `${slug}: seed row lacks gacha:true — reauthoring it would recreate the un-openable box`
    )
}

/** Pure chain-vs-seed diff for the 3 pet boxes. `live_rows` are /v1/shop rows enriched with their
 * /v1/encyclopedia item snapshot under `.template`. Old ids come from the PINNED incident facts in
 * BOX_APPROVALS (never the manifest — see the receipt law above). Converged boxes are omitted from
 * `reauthor_boxes` (rerun-idempotent) but still land in `manifest_receipt`: the LIVE corrected
 * slug→template-id rows the ceremony writes back into seed_manifest.json (manifest_writeback.mjs). */
export function build_box_plan({ live_rows, box_rows, seed_manifest }) {
  if (!Array.isArray(live_rows))
    throw new Error('live shop rows must be an array')
  const by_slug = box_index(box_rows)
  const plan = { reauthor_boxes: [], manifest_receipt: [] }
  for (const slug of box_slugs) {
    const old_template_id = require_id(
      BOX_APPROVALS[slug].old_template_id,
      `box ${slug} pinned old template id`
    )
    const box_row = by_slug.get(slug)
    if (!box_row) throw new Error(`pet_boxes.json is missing box ${slug}`)
    validate_box_seed(box_row, slug)
    const pool = resolve_pool(box_row, seed_manifest, slug)
    const old_sale = sale_for_template(live_rows, old_template_id, slug)
    if (old_sale) require_sale_shape(old_sale, slug)
    const desired = live_rows.filter(
      (row) =>
        row.template_id !== old_template_id &&
        box_template_matches(row.template, box_row)
    )
    if (desired.length > 1)
      throw new Error(
        `${slug}: ${desired.length} corrected box sales already exist; refusing to guess canonical`
      )
    const desired_sale = desired.at(0) ?? null
    const price_mist = String(BigInt(box_row.price_sui) * sui_to_mist)
    if (desired_sale) {
      require_sale_shape(desired_sale, slug)
      if (String(desired_sale.price_mist) !== price_mist)
        throw new Error(
          `${slug}: corrected sale price ${desired_sale.price_mist} ≠ expected ${price_mist}`
        )
      plan.manifest_receipt.push({
        slug,
        template_id: desired_sale.template_id,
      })
      if (!old_sale) continue // fully converged — corrected sale live, old sale already burned
    }
    if (!old_sale)
      throw new Error(
        `${slug}: neither old sale nor corrected sale is visible; refusing to invent old minted`
      )
    const fresh_supply = box_row.supply - old_sale.minted
    if (fresh_supply < 0)
      throw new Error(
        `${slug}: old minted ${old_sale.minted} exceeds seed cap ${box_row.supply}`
      )
    plan.reauthor_boxes.push({
      slug,
      old_template_id,
      old_sale_id: old_sale.sale_id,
      old_minted: old_sale.minted,
      old_paused: old_sale.paused,
      create_fresh: !desired_sale,
      existing_sale_id: desired_sale?.sale_id ?? null,
      fresh_template: {
        name: box_row.name,
        description: box_row.description ?? '',
        item_type: box_row.itemType,
        category: box_category(box_row),
        level: box_row.level ?? 1,
      },
      price_mist,
      fresh_supply: desired_sale ? null : fresh_supply,
      pool,
      steps: [
        ...(old_sale.paused ? [] : ['set_paused']),
        'burn_sale',
        ...(desired_sale
          ? []
          : ['create_template', 'create_sale', 'set_loot_table']),
      ],
    })
  }
  return plan
}

// ── tx builders (self-contained PTB helpers so this module carries no import from apply_shop_payload) ─────────
function move_option(tx, type, value) {
  const some = value !== undefined
  return tx.moveCall({
    target: `0x1::option::${some ? 'some' : 'none'}`,
    typeArguments: [type],
    arguments: some ? [value] : [],
  })
}
// packages/move/aresrpg/sources/shop.move — set_paused(cap, &mut Sale, bool, version) / burn_sale(cap, Sale, version).
function sale_admin_call(tx, function_name, sale_id, deployment, extra = []) {
  tx.moveCall({
    target: `${deployment.call_package}::shop::${function_name}`,
    arguments: [
      tx.object(deployment.admin),
      tx.object(sale_id),
      ...extra,
      tx.object(deployment.version),
    ],
  })
}

// One ATOMIC PTB: pause+burn the old sale, then (unless converged) create the corrected template WITH the gacha
// effect, create the replacement sale, and set the loot table on the FRESH template id. `create_template` returns
// an `ID` (item::share_template), and ID has `copy`, so the SAME result threads into both create_sale and
// admin_set_loot_table — no read-back, one atomic tx (so idempotency is a single "does the corrected sale exist").
export function reauthor_box_tx(operation, deployment) {
  const tx = new Transaction()
  if (!operation.old_paused)
    sale_admin_call(tx, 'set_paused', operation.old_sale_id, deployment, [
      tx.pure.bool(true),
    ])
  sale_admin_call(tx, 'burn_sale', operation.old_sale_id, deployment)
  if (!operation.create_fresh) return tx
  const stats_type = `${deployment.origin_package}::item_stats::ItemStatistics`
  const damage_type = `${deployment.origin_package}::item_damages::ItemDamages`
  const effect_type = `${deployment.origin_package}::consumable_effect::ConsumableEffect`
  // KIND_GACHA_ROLL, amount 0 — the pool IS the loot table (mirrors seed_full_corpus.mjs buildItemCreate).
  const effect = move_option(
    tx,
    effect_type,
    tx.moveCall({
      target: `${deployment.call_package}::consumable_effect::new`,
      arguments: [
        tx.moveCall({
          target: `${deployment.call_package}::consumable_effect::gacha_roll`,
        }),
        tx.pure.u64(0),
      ],
    })
  )
  // packages/move/aresrpg/sources/admin.move create_template(...) : ID — attaches the effect BEFORE sharing.
  const template_id = tx.moveCall({
    target: `${deployment.call_package}::admin::create_template`,
    arguments: [
      tx.object(deployment.admin),
      tx.object(deployment.catalog),
      tx.pure.string(operation.fresh_template.name),
      tx.pure.string(operation.fresh_template.description),
      tx.pure.string(operation.fresh_template.item_type),
      tx.pure.string(operation.fresh_template.icon ?? operation.fresh_template.item_type), // R4 icon slug (defaults to item_type)
      tx.pure.string(operation.fresh_template.category),
      tx.pure.u16(operation.fresh_template.level),
      move_option(tx, stats_type), // stats_min: none (a consumable carries no roll ranges)
      move_option(tx, stats_type), // stats_max: none
      tx.makeMoveVec({ type: damage_type, elements: [] }), // no weapon damage lines
      effect, // some(KIND_GACHA_ROLL) — the whole point of the fix
      tx.object(deployment.version),
    ],
  })
  const supply = move_option(tx, 'u64', tx.pure.u64(operation.fresh_supply))
  tx.moveCall({
    target: `${deployment.call_package}::shop::create_sale`,
    arguments: [
      tx.object(deployment.admin),
      template_id,
      tx.pure.u64(BigInt(operation.price_mist)),
      supply,
      tx.object(deployment.version),
    ],
  })
  // packages/move/gifting/sources/loot_box.move admin_set_loot_table(cap, &mut LootRegistry, box_template: ID,
  // pet_templates: vector<ID>, weights: vector<u64>, version) — keyed by the FRESH box template id.
  tx.moveCall({
    target: `${deployment.gifting_package}::loot_box::admin_set_loot_table`,
    arguments: [
      tx.object(deployment.admin),
      tx.object(deployment.loot_registry),
      template_id,
      tx.pure.vector(
        'id',
        operation.pool.map((entry) => entry.template_id)
      ),
      tx.pure.vector(
        'u64',
        operation.pool.map((entry) => entry.weight)
      ),
      tx.object(deployment.version),
    ],
  })
  return tx
}
