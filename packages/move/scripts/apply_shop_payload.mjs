// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Approved shop content correction. Runtime truth comes from the /v1 read
// layer and the corrected seed; sale ids are never embedded here (the PINNED
// reauthor old-template ids are incident facts, not runtime state). DRY_RUN is
// the default and only LIVE=1 can sign with client.js's active CLI-keystore
// signer. Every LIVE run maintains the seed-manifest receipt (receipt law —
// manifest_writeback.mjs): corrected template ids are written back in-run.
import { readFileSync as read_file_sync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

import { box_slugs, build_box_plan, reauthor_box_tx } from './box_reauthor.mjs'
import { deriveBudget as derive_budget, run } from './ceremony_lib.mjs'
import {
  apply_manifest_writeback,
  writeback_rows,
} from './manifest_writeback.mjs'
import { fetch_live_rows } from './shop_live_rows.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const repo_dir = resolve(script_dir, '..', '..', '..')
const ceiling_sui = 0.3
const sui_to_mist = 1_000_000_000n
const read_json = (file_path) => JSON.parse(read_file_sync(file_path, 'utf8'))

const delist_slugs = [
  'cape_lorito_air',
  'cape_lorito_earth',
  'cape_lorito_fire',
  'cape_lorito_water',
  'corbac_helmet',
]
const rename_slugs = [
  'cape_lorito_agility',
  'cape_lorito_chance',
  'cape_lorito_intelligence',
  'cape_lorito_strength',
  'cape_lorito_vitality',
  'cape_lorito_wisdom',
]
const historical_rename_targets = [
  ['cape_lorito_air', 'Lorito Cloak (Opal)'],
  ['cape_lorito_water', 'Lorito Cloak (Aquamarine)'],
  ['cape_lorito_fire', 'Lorito Cloak (Garnet)'],
  ['cape_lorito_earth', 'Lorito Cloak (Jade)'],
]
// Reauthor targets: approved price/supply + the PINNED old template ids this incident burns.
// The old ids are incident facts — NEVER resolved from seed_manifest.json, which is the ceremony's
// OUTPUT receipt of the living generation (manifest_writeback.mjs): reading the receipt as "the old
// id" would burn the corrected sale on every rerun once the receipt is fresh.
export const reauthor_targets = {
  momaku: {
    approved_price_sui: 560,
    approved_supply: 56,
    old_template_id:
      '0xfa660930e9c302c18cddd2fa127e7d10f152a77bc004ba9ee4bb0038b2d17eee',
  },
  enka_muru: {
    approved_price_sui: 165,
    approved_supply: 194,
    old_template_id:
      '0x01c037f602a3ea19e6844c06565ae47f7b0bf482d8118c4969e823dee6c43d36',
  },
  // MO HOOD hat→cloak (content review): category is immutable in place (admin.move —
  // "a stats/category change is a re-author, not a rename"), so the hat-authored template is burned
  // (minted 0/300 re-asserted pre-burn) and re-authored as the cloak the seed now describes.
  capuche_mo: {
    approved_price_sui: 40,
    approved_supply: 300,
    old_template_id:
      '0xa749315c300c79ad95429cb146d7b540ee3a05309d2b18ed4038c1d00db3ce29',
  },
}
// delists + renames still operate ON the manifest's live rows (their ids never change);
// reauthor slugs left this set with the receipt law — their old ids are pinned above.
const target_slugs = delist_slugs.concat(rename_slugs)
export function shop_template_ids(seed_manifest) {
  const items = seed_manifest?.items
  if (!items || typeof items !== 'object' || Array.isArray(items))
    throw new Error('seed manifest has no items map')
  return Object.fromEntries(
    target_slugs.map((slug) => {
      const template_id = items[slug]
      if (!/^0x[0-9a-f]{64}$/i.test(template_id ?? ''))
        throw new Error(`seed manifest has invalid item id for ${slug}`)
      return [slug, template_id]
    })
  )
}
function seed_index(seed_rows) {
  if (!Array.isArray(seed_rows))
    throw new Error('shop seed rows must be an array')
  const by_slug = new Map()
  for (const row of seed_rows) {
    if (!row?.slug) throw new Error('shop seed row is missing slug')
    if (by_slug.has(row.slug))
      throw new Error(`duplicate shop seed slug ${row.slug}`)
    by_slug.set(row.slug, row)
  }
  return by_slug
}
function required_seed_row(by_slug, slug) {
  const row = by_slug.get(slug)
  if (!row) throw new Error(`corrected shop seed is missing ${slug}`)
  if (typeof row.name !== 'string' || typeof row.description !== 'string')
    throw new Error(`corrected shop seed ${slug} lacks name/description`)
  return row
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
function require_template(sale, label) {
  const template = sale?.template
  if (
    !template ||
    typeof template.name !== 'string' ||
    typeof template.description !== 'string'
  )
    throw new Error(
      `${label}: /v1/encyclopedia has not resolved name/description for ${sale?.template_id}; refusing a blind rename`
    )
  return template
}
function seed_price_mist(row, label) {
  if (!Number.isSafeInteger(row.price_sui) || row.price_sui <= 0)
    throw new Error(`${label}: seed price_sui must be a positive integer`)
  return String(BigInt(row.price_sui) * sui_to_mist)
}
function template_matches_seed(template, seed_row) {
  return (
    template?.name === seed_row.name &&
    template?.description === seed_row.description &&
    template?.item_type === seed_row.itemType &&
    template?.category === seed_row.category &&
    template?.level === (seed_row.level ?? 1)
  )
}
function validate_reauthor_seed(seed_row, slug, target) {
  if (
    seed_row.price_sui !== target.approved_price_sui ||
    seed_row.supply !== target.approved_supply
  )
    throw new Error(
      `${slug}: corrected seed price/supply drifted from owner approval (${target.approved_price_sui} SUI × ${target.approved_supply})`
    )
  if (seed_row.itemType !== 'cloak' || seed_row.category !== 'cloak')
    throw new Error(`${slug}: corrected seed must author a cloak template`)
}
/** Pure chain-vs-seed diff. `live_rows` are /v1/shop rows enriched with their
 * /v1/encyclopedia item snapshot under `.template`. Only approved targets are
 * considered; converged operations are omitted from the op arrays (rerun-
 * idempotent) but corrected reauthor templates still land in `manifest_receipt`
 * — the LIVE slug→template-id rows the ceremony writes back into
 * seed_manifest.json in the same run (manifest_writeback.mjs receipt law). */
export function build_shop_plan({ live_rows, seed_rows, seed_manifest }) {
  if (!Array.isArray(live_rows))
    throw new Error('live shop rows must be an array')
  const by_slug = seed_index(seed_rows)
  const template_ids = shop_template_ids(seed_manifest)
  const plan = { delists: [], renames: [], reauthors: [], manifest_receipt: [] }
  for (const slug of delist_slugs) {
    const template_id = template_ids[slug]
    if (by_slug.has(slug))
      throw new Error(
        `${slug}: corrected seed still contains an approved duplicate`
      )
    const sale = sale_for_template(live_rows, template_id, slug)
    if (!sale) continue
    require_sale_shape(sale, slug)
    plan.delists.push({
      slug,
      template_id,
      sale_id: sale.sale_id,
      minted: sale.minted,
      supply_remaining: sale.supply_remaining,
      paused: sale.paused,
      steps: sale.paused ? ['burn_sale'] : ['set_paused', 'burn_sale'],
    })
  }
  for (const slug of rename_slugs) {
    const template_id = template_ids[slug]
    const seed_row = required_seed_row(by_slug, slug)
    const sale = sale_for_template(live_rows, template_id, slug)
    if (!sale)
      throw new Error(`${slug}: approved live sale/template is missing`)
    require_sale_shape(sale, slug)
    const template = require_template(sale, slug)
    if (
      template.name === seed_row.name &&
      template.description === seed_row.description
    )
      continue
    plan.renames.push({
      slug,
      template_id,
      sale_id: sale.sale_id,
      minted: sale.minted,
      paused: sale.paused,
      from: { name: template.name, description: template.description },
      to: { name: seed_row.name, description: seed_row.description },
      steps: ['set_template_name_description'],
    })
  }
  for (const [slug, target] of Object.entries(reauthor_targets)) {
    const { old_template_id } = target
    if (!/^0x[0-9a-f]{64}$/i.test(old_template_id ?? ''))
      throw new Error(`${slug}: reauthor target has no pinned old template id`)
    const seed_row = required_seed_row(by_slug, slug)
    validate_reauthor_seed(seed_row, slug, target)
    const old_sale = sale_for_template(live_rows, old_template_id, slug)
    if (old_sale) require_sale_shape(old_sale, slug)
    const desired_sales = live_rows.filter(
      (row) =>
        row.template_id !== old_template_id &&
        template_matches_seed(row.template, seed_row)
    )
    if (desired_sales.length > 1)
      throw new Error(
        `${slug}: ${desired_sales.length} corrected sales already exist; refusing to guess which is canonical`
      )
    const desired_sale = desired_sales.at(0) ?? null
    const price_mist = seed_price_mist(seed_row, slug)
    if (desired_sale) {
      require_sale_shape(desired_sale, slug)
      if (String(desired_sale.price_mist) !== price_mist)
        throw new Error(
          `${slug}: corrected sale price is ${desired_sale.price_mist}, expected ${price_mist}; repricing is outside this payload`
        )
      if (
        !Number.isSafeInteger(desired_sale.supply_remaining) ||
        desired_sale.supply_remaining < 0
      )
        throw new Error(`${slug}: corrected sale must have a finite supply`)
      const corrected_cap = desired_sale.minted + desired_sale.supply_remaining
      if (corrected_cap > seed_row.supply)
        throw new Error(
          `${slug}: corrected sale cap ${corrected_cap} exceeds seed cap ${seed_row.supply}`
        )
      plan.manifest_receipt.push({
        slug,
        template_id: desired_sale.template_id,
      })
      if (!old_sale) continue
    }
    if (!old_sale)
      throw new Error(
        `${slug}: neither old sale nor corrected sale is visible; refusing to invent old minted`
      )
    const fresh_supply = seed_row.supply - old_sale.minted
    if (fresh_supply < 0)
      throw new Error(
        `${slug}: old minted ${old_sale.minted} exceeds seed cap ${seed_row.supply}`
      )
    plan.reauthors.push({
      slug,
      old_template_id,
      old_sale_id: old_sale.sale_id,
      old_minted: old_sale.minted,
      old_paused: old_sale.paused,
      create_fresh: !desired_sale,
      existing_template_id: desired_sale?.template_id ?? null,
      existing_sale_id: desired_sale?.sale_id ?? null,
      fresh_template: {
        name: seed_row.name,
        description: seed_row.description,
        item_type: seed_row.itemType,
        category: seed_row.category,
        level: seed_row.level ?? 1,
      },
      price_mist,
      fresh_supply: desired_sale ? null : fresh_supply,
      steps: [
        ...(old_sale.paused ? [] : ['set_paused']),
        'burn_sale',
        ...(desired_sale ? [] : ['create_template', 'create_sale']),
      ],
    })
  }
  return plan
}
export function resolve_mode(environment) {
  if (environment.LIVE != null && environment.LIVE !== '1')
    throw new Error('LIVE must be exactly 1 when set')
  const dry_run = environment.DRY_RUN
  if (dry_run != null && !['0', '1'].includes(dry_run))
    throw new Error('DRY_RUN must be 0 or 1 when set')
  const live = environment.LIVE === '1'
  if (live && dry_run === '1')
    throw new Error('LIVE=1 conflicts with DRY_RUN=1')
  if (!live && dry_run === '0') throw new Error('DRY_RUN=0 requires LIVE=1')
  return { live, dry_run: !live }
}
export function build_historical_renames(template_by_id, template_ids) {
  const operations = []
  for (const [slug, name] of historical_rename_targets) {
    const template = template_by_id.get(template_ids[slug])
    if (!template)
      throw new Error(
        `${slug}: historical template ${template_ids[slug]} is missing`
      )
    if (template.name === name) continue
    if (
      typeof template.name !== 'string' ||
      typeof template.description !== 'string'
    )
      throw new Error(
        `${slug}: historical template lacks name/description; refusing a blind rename`
      )
    operations.push({
      slug,
      template_id: template.template_id,
      from: { name: template.name, description: template.description },
      to: { name, description: template.description },
      steps: ['set_template_name_description'],
    })
  }
  return operations
}
async function existing_sale_rows(live_rows, client) {
  const { objects } = await client.getObjects({
    objectIds: live_rows.map(({ sale_id }) => sale_id),
  })
  if (objects.length !== live_rows.length)
    throw new Error('sale object preflight returned the wrong row count')
  return live_rows.filter((row, index) => {
    const object = objects[index]
    if (!(object instanceof Error)) {
      if (object.objectId !== row.sale_id)
        throw new Error(
          `sale object preflight order mismatch at ${row.sale_id}`
        )
      return true
    }
    if (!/not found|deleted|does not exist|not exist/i.test(object.message))
      throw new Error(`sale ${row.sale_id} preflight failed: ${object.message}`)
    console.log(`  SKIP stale /v1 row ${row.sale_id} (sale object is deleted)`)
    return false
  })
}
function move_option(tx, type, value) {
  const some = value !== undefined
  return tx.moveCall({
    target: `0x1::option::${some ? 'some' : 'none'}`,
    typeArguments: [type],
    arguments: some ? [value] : [],
  })
}
// packages/move/aresrpg/sources/shop.move:151-174 — set_paused
// (cap, &mut Sale, bool, version) then burn_sale(cap, Sale, version).
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
function delist_tx(operation, deployment) {
  const tx = new Transaction()
  if (!operation.paused)
    sale_admin_call(tx, 'set_paused', operation.sale_id, deployment, [
      tx.pure.bool(true),
    ])
  sale_admin_call(tx, 'burn_sale', operation.sale_id, deployment)
  return tx
}
// packages/move/aresrpg/sources/admin.move:155-176 — only name and
// description are mutable: (cap, &mut ItemTemplate, name, description, version).
function rename_tx(operation, deployment) {
  const tx = new Transaction()
  tx.moveCall({
    target: `${deployment.call_package}::admin::set_template_name_description`,
    arguments: [
      tx.object(deployment.admin),
      tx.object(operation.template_id),
      tx.pure.string(operation.to.name),
      tx.pure.string(operation.to.description),
      tx.object(deployment.version),
    ],
  })
  return tx
}
// packages/move/aresrpg/sources/admin.move:79-132 creates and returns the
// shared template ID; shop.move:96-121 consumes that ID to create its Sale.
function reauthor_tx(operation, deployment) {
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
  const template_id = tx.moveCall({
    target: `${deployment.call_package}::admin::create_template`,
    arguments: [
      tx.object(deployment.admin),
      tx.object(deployment.catalog),
      tx.pure.string(operation.fresh_template.name),
      tx.pure.string(operation.fresh_template.description),
      tx.pure.string(operation.fresh_template.item_type),
      tx.pure.string(operation.fresh_template.category),
      tx.pure.u16(operation.fresh_template.level),
      move_option(tx, stats_type),
      move_option(tx, stats_type),
      tx.makeMoveVec({ type: damage_type, elements: [] }),
      move_option(tx, effect_type),
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
  return tx
}
function deployment_from_release(release_config, environment) {
  const network = environment.NETWORK ?? 'testnet'
  const network_release = release_config.networks?.[network]
  const aresrpg = network_release?.packages?.aresrpg
  const gifting = network_release?.packages?.gifting // box reauthor: loot_box + LootRegistry live here
  const deployment = {
    origin_package: aresrpg?.origin,
    call_package: aresrpg?.latest,
    admin: aresrpg?.admin,
    version: network_release?.shared?.VERSION?.id,
    catalog: network_release?.shared?.CATALOG?.id,
    gifting_package: gifting?.latest ?? gifting?.origin,
    loot_registry: network_release?.shared?.LOOT_REGISTRY?.id,
  }
  for (const [field, value] of Object.entries(deployment))
    if (!/^0x[0-9a-f]{64}$/i.test(value ?? ''))
      throw new Error(
        `release.json has invalid deployment id for ${field} (network=${network})`
      )
  return { ...deployment, network }
}
// `op` rides along so the LIVE loop can harvest each create_fresh receipt for the
// manifest write-back (the freshly minted ItemTemplate id only exists post-execution).
function transactions_from_plan(plan, deployment) {
  return [
    ...plan.delists.map((operation) => ({
      label: `shop:delist:${operation.slug}`,
      tx: delist_tx(operation, deployment),
      op: operation,
    })),
    ...plan.renames.map((operation) => ({
      label: `shop:rename:${operation.slug}`,
      tx: rename_tx(operation, deployment),
      op: operation,
    })),
    ...plan.reauthors.map((operation) => ({
      label: `shop:reauthor:${operation.slug}`,
      tx: reauthor_tx(operation, deployment),
      op: operation,
    })),
    ...(plan.reauthor_boxes ?? []).map((operation) => ({
      label: `shop:reauthor_box:${operation.slug}`,
      tx: reauthor_box_tx(operation, deployment),
      op: operation,
    })),
  ]
}
function print_plan(plan, mode, deployment) {
  console.log(
    `=== SHOP CONTENT PLAN | ${mode.live ? 'LIVE' : 'DRY_RUN=1'} | network=${deployment.network} ===`
  )
  console.log(
    `package=${deployment.call_package} admin=${deployment.admin} version=${deployment.version} catalog=${deployment.catalog}`
  )
  console.log(JSON.stringify(plan, null, 2))
  for (const [name, targets] of [
    ['delists', delist_slugs],
    [
      'renames',
      rename_slugs.concat(historical_rename_targets.map(([slug]) => slug)),
    ],
    ['reauthors', Object.keys(reauthor_targets)],
    ['reauthor_boxes', box_slugs],
  ]) {
    const planned = new Set((plan[name] ?? []).map(({ slug }) => slug))
    for (const slug of targets)
      if (!planned.has(slug)) console.log(`  SKIP ${name}:${slug} (converged)`)
  }
}
async function main() {
  const mode = resolve_mode(process.env)
  if (process.env.PRIVATE_KEY)
    throw new Error(
      'PRIVATE_KEY is forbidden for this payload; use the active CLI keystore (server-aresrpg)'
    )
  const seed_manifest = read_json(join(script_dir, 'out', 'seed_manifest.json'))
  const seed = read_json(join(repo_dir, 'seed', 'mainnet', 'shop.json'))
  const pet_boxes = read_json(
    join(repo_dir, 'seed', 'mainnet', 'pet_boxes.json')
  )
  const deployment = deployment_from_release(release, process.env)
  const { sale_rows: api_rows, template_by_id } = await fetch_live_rows()
  // Required /v1 resolution first; this gRPC object-existence check is only a
  // tx preflight, filtering SaleBurned rows a lagging projection still returns.
  const { keypair, sui_client } = await import('./client.js')
  const live_rows = await existing_sale_rows(api_rows, sui_client)
  const shop_plan = build_shop_plan({
    live_rows,
    seed_rows: seed.cosmetics,
    seed_manifest,
  })
  const box_plan = build_box_plan({
    live_rows,
    box_rows: pet_boxes.boxes,
    seed_manifest,
  })
  const plan = {
    ...shop_plan,
    renames: [
      ...shop_plan.renames,
      ...build_historical_renames(
        template_by_id,
        shop_template_ids(seed_manifest)
      ),
    ],
    reauthor_boxes: box_plan.reauthor_boxes,
    manifest_receipt: [
      ...shop_plan.manifest_receipt,
      ...box_plan.manifest_receipt,
    ],
  }
  print_plan(plan, mode, deployment)
  const transactions = transactions_from_plan(plan, deployment)
  const minted = []
  if (!transactions.length)
    console.log('=== SHOP CONTENT ALREADY CONVERGED (0 transactions) ===')
  else {
    console.log(
      `signer ${keypair.getPublicKey().toSuiAddress()} (active CLI keystore)`
    )

    // Every call in this payload is simulatable (none consumes &Random), so every
    // tx uses deriveBudget's dryRun x1.5 path. The 0.3-SUI ceiling is enforced
    // before signing; there is no fixed-budget exception in this payload.
    for (const { label, tx, op } of transactions) {
      if (mode.live) {
        const receipt = await run(sui_client, keypair, label, tx, {
          ceilingSui: ceiling_sui,
        })
        if (op?.create_fresh) minted.push({ slug: op.slug, receipt })
      } else {
        const budget = await derive_budget(
          sui_client,
          keypair,
          tx,
          label,
          ceiling_sui
        )
        console.log(`  [${label}] dry-run OK, derived budget=${budget} MIST`)
      }
    }
  }
  // THE RECEIPT LAW (SHOP TRIO (a) root fix): the manifest receipt is refreshed in
  // the SAME RUN that mints (or first observes) a corrected template — a LIVE
  // zero-op run still heals a stale receipt; DRY_RUN only reports pending rows.
  apply_manifest_writeback({
    manifest_path: join(script_dir, 'out', 'seed_manifest.json'),
    seed_manifest,
    rows: writeback_rows({ manifest_receipt: plan.manifest_receipt, minted }),
    live: mode.live,
  })
  if (transactions.length)
    console.log(
      mode.live
        ? '=== SHOP CONTENT PAYLOAD APPLIED ==='
        : '=== DRY-RUN COMPLETE (0 transactions signed) ==='
    )
}

const is_main =
  process.argv[1] &&
  resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main)
  main().catch((error) => {
    console.error(`\nSHOP CONTENT PAYLOAD STOPPED: ${error.message}`)
    console.error('No automatic retry was attempted.')
    process.exitCode = 1
  })
