// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TOPUP SALES — one-shot shop delta for the 2026-07-13 re-mint wave: (1) create the Veteran title sale
// (mark_of_the_unbroken / slug title_veteran, 500 SUI × supply 150 — fixed reference numbers) and (2) re-price
// casque_hayate 500 → 499 via shop::set_price (Sales are MUTABLE: set_price exists in shop.move v3 — no sale
// re-mint needed). Runs OUTSIDE seed_full_corpus's PHASE 7 because that phase's resume is CHUNK-digest keyed
// (shop:<i> labels), so a row appended to shop.json after a completed run can never mint through it without
// re-firing whole chunks (= duplicate Sale objects).
//
// MONEY LAW: ceremony_lib `run` (dryRun ×1.5, NO retry of an executed failure); per-op labels in the seed
// manifest digests (skip-if-present); prices through sui_to_sale_mist (BigInt-exact, coherent-range refuse).
//
// RUN: PRIVATE_KEY=<key> NETWORK=testnet SEED_CONFIRM_REMOTE=testnet \
//        CASQUE_SALE=<sale object id> node packages/move/scripts/topup_sales.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from './client.js'
import { run, netGas } from './ceremony_lib.mjs'
import { sui_to_sale_mist } from './seed_economy.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const CM = JSON.parse(fs.readFileSync(path.join(__dir, 'out', 'ceremony_manifest.json'), 'utf8'))
const OUT_PATH = path.join(__dir, 'out', 'seed_manifest.json')
const M = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))

const CITEMS = CM.items.latest ?? CM.items.pkg
const CAP = CM.items.admin
const VER = CM.items.version
const persist = () => fs.writeFileSync(OUT_PATH, JSON.stringify(M, null, 2))

const confirm = process.env.SEED_CONFIRM_REMOTE
if (confirm !== (process.env.NETWORK || 'testnet'))
  throw new Error('topup_sales mutates the live shop — set SEED_CONFIRM_REMOTE=<network> to confirm')

const { CASQUE_SALE } = process.env
if (!CASQUE_SALE) throw new Error('CASQUE_SALE=<Sale object id for casque_hayate> is required')

// Fixed shop numbers (seed/mainnet/shop.json _meta: veteran 500×150; casque nudged 500→499).
const VETERAN = { slug: 'title_veteran', price_sui: 500, supply: 150 }
const CASQUE_PRICE_SUI = 499

async function exec(label, build) {
  if (M.digests?.[label]) {
    console.log(`  [${label}] SKIP (already: ${M.digests[label].slice(0, 8)}…)`)
    return null
  }
  const tx = new Transaction()
  build(tx)
  const r = await run(sui_client, keypair, label, tx, { ceilingSui: 0.2 })
  M.digests[label] = r.digest
  M.gas.totalMist += netGas(r.effects.gasUsed)
  M.gas.totalSui = M.gas.totalMist / 1e9
  persist()
  return r
}

async function main() {
  console.log(`=== TOPUP SALES · signer=${keypair.getPublicKey().toSuiAddress()} ===`)
  const template = M.items[VETERAN.slug]
  if (!template) throw new Error(`'${VETERAN.slug}' has no minted template — run the item top-up first`)

  const r = await exec('shop:title_veteran', (tx) => {
    const supply = tx.moveCall({
      target: '0x1::option::some',
      typeArguments: ['u64'],
      arguments: [tx.pure.u64(VETERAN.supply)],
    })
    tx.moveCall({
      target: `${CITEMS}::shop::create_sale`,
      arguments: [
        tx.object(CAP),
        tx.pure.id(template),
        tx.pure.u64(sui_to_sale_mist(VETERAN.price_sui)),
        supply,
        tx.object(VER),
      ],
    })
  })
  if (r && !M.shop.some((s) => s.template === template)) {
    // PHASE 7's summary rebuild may already list the row (it maps FRESH.shop even when every chunk skipped);
    // the Sale OBJECT is what this tx creates — never a second summary row.
    M.shop.push({
      template,
      price_mist: sui_to_sale_mist(VETERAN.price_sui).toString(),
      supply: VETERAN.supply,
    })
    persist()
  }

  await exec('shop:price:casque_hayate', (tx) => {
    tx.moveCall({
      target: `${CITEMS}::shop::set_price`,
      arguments: [
        tx.object(CAP),
        tx.object(CASQUE_SALE),
        tx.pure.u64(sui_to_sale_mist(CASQUE_PRICE_SUI)),
        tx.object(VER),
      ],
    })
  })
  console.log('\ntopup_sales complete')
}

main().catch((e) => {
  persist()
  console.error(`\nTOPUP SALES STOPPED: ${e.message}`)
  process.exit(1)
})
