// Apply the pet-power admin payload derived directly from the current seed receipt. One PTB per batch, in order
// (template stats first, then foods), on ceremony_lib's primitives: dryRun-derived ceiling-guarded budgets +
// the no-retry SUCCESS runner (an executed failure has a digest and is NEVER auto-retried — it THROWS, which
// IS the failure latch). Reruns are safe by construction: both entry fns are idempotent overwrites
// (set_template_stats replaces ranges in place; set_food_power upserts the table row).
//
//   NETWORK=testnet node apply_pet_payload.mjs            # dry-run every batch, execute nothing
//   NETWORK=testnet LIVE=1 node apply_pet_payload.mjs     # execute (keystore signer — server-aresrpg)
import { Transaction } from '@mysten/sui/transactions'

import { pet_feed_payload } from '../../../seed/generators/pet_feed_payload.mjs'

import { keypair, sui_client } from './client.js'
import { deriveBudget, run } from './ceremony_lib.mjs'

const LIVE = process.env.LIVE === '1'
const CEILING_SUI = 0.3 // per batch — the 49-call food batch MEASURES 0.149 SUI (storage-heavy table upserts); budgets stay dryRun-derived, this only caps them

function batch_tx(batch) {
  const tx = new Transaction()
  for (const call of batch.calls) {
    const a = call.arguments
    if (call.target.endsWith('::admin::set_template_stats'))
      tx.moveCall({
        target: call.target,
        arguments: [
          tx.object(a.admin_cap_id),
          tx.object(a.pet_template_id),
          ...a.min_stats_u16.map((v) => tx.pure.u16(v)),
          ...a.max_stats_u16.map((v) => tx.pure.u16(v)),
          tx.object(a.version_id),
        ],
      })
    else if (call.target.endsWith('::pet::set_food_power'))
      tx.moveCall({
        target: call.target,
        arguments: [
          tx.object(a.admin_cap_id),
          tx.object(a.version_id),
          tx.object(a.feed_config_id),
          tx.pure.id(a.food_template_id),
          tx.pure.u64(a.power_per_unit),
        ],
      })
    else throw new Error(`unknown target in payload: ${call.target}`)
  }
  return tx
}

console.log(
  `signer ${keypair.toSuiAddress()} | ${LIVE ? 'LIVE' : 'DRY-RUN ONLY'}`
)

const batches = [
  ...pet_feed_payload.pet_template_stats.batches,
  ...pet_feed_payload.pet_foods.batches,
]
for (const batch of batches) {
  if (LIVE) {
    await run(sui_client, keypair, batch.label, batch_tx(batch), {
      ceilingSui: CEILING_SUI,
    })
  } else {
    const budget = await deriveBudget(
      sui_client,
      keypair,
      batch_tx(batch),
      batch.label,
      CEILING_SUI
    )
    console.log(
      `  [${batch.label}] calls=${batch.calls.length} dry-run OK, derived budget=${budget} MIST`
    )
  }
}
console.log(
  LIVE
    ? '=== PET PAYLOAD APPLIED ==='
    : '=== DRY-RUN COMPLETE (nothing executed) ==='
)
