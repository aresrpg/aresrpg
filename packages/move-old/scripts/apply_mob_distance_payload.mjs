// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Apply the mob-distance payload derived from the current seed receipt. One PTB per world; dry-run is the
// default. LIVE uses the ceremony runner's dryRun×1.5 budget and never retries an executed digest.
//
//   NETWORK=testnet node packages/move/scripts/apply_mob_distance_payload.mjs
//   NETWORK=testnet LIVE=1 node packages/move/scripts/apply_mob_distance_payload.mjs
import { Transaction } from '@mysten/sui/transactions'

import { mob_distance_payload } from '../../../seed/generators/mob_distance_payload.mjs'

import { keypair, sui_client } from './client.js'
import { deriveBudget as derive_budget, run } from './ceremony_lib.mjs'

const live = process.env.LIVE === '1'
const ceiling_sui = 0.3

function batch_tx(batch) {
  const tx = new Transaction()
  for (const call of batch.calls) {
    const args = call.arguments
    tx.moveCall({
      target: call.target,
      arguments: [
        tx.object(args.admin_cap_id),
        tx.object(args.world_id),
        tx.pure.id(args.template_id),
        tx.pure.u16(args.max_level),
        tx.object(args.version_id),
      ],
    })
  }
  return tx
}

console.log(
  `signer ${keypair.toSuiAddress()} | ${live ? 'LIVE' : 'DRY-RUN ONLY'} | worlds=${mob_distance_payload.world_count} calls=${mob_distance_payload.call_count}`
)
for (const batch of mob_distance_payload.batches) {
  if (live)
    await run(sui_client, keypair, batch.label, batch_tx(batch), {
      ceilingSui: ceiling_sui,
    })
  else {
    const budget = await derive_budget(sui_client, keypair, batch_tx(batch), batch.label, ceiling_sui)
    console.log(`  [${batch.label}] calls=${batch.calls.length} dry-run OK, derived budget=${budget} MIST`)
  }
}
console.log(live ? '=== MOB DISTANCE PAYLOAD APPLIED ===' : '=== DRY-RUN COMPLETE (nothing executed) ===')
