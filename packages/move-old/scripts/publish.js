// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execSync } from 'child_process'

import { Transaction } from '@mysten/sui/transactions'

import { NETWORK, keypair, sui_client } from './client.js'
import { assert_publishable_tree, with_env } from './env_guard.mjs'

// publish gate: the localnet publish_guard was retired 2026-07-14 (REDUCTION_PLAN §8) — the honest gate is `ares test` (SINGLE_FRAMEWORK_SPEC)

// FAIL-CLOSED before anything is built or signed (#1298): the publishing HEAD must already be on
// trunk. Ceremony #3 published from an unmerged draft branch — live bytecode edge never carried.
// No override exists; a tree that is not on edge lands on edge first.
assert_publishable_tree({ paths: ['./'] })

const tx = new Transaction()

console.log('==================== [ PUBLISHING PACKAGE ] ====================')
console.log('network:', NETWORK)
console.log('public key:', keypair.getPublicKey().toSuiAddress())
console.log(' ')

// NOTE: `--dev` was dropped by sui CLI >=1.74 (unexpected-argument error, hard-crashes this script).
// Never re-add it — there is no dev/non-dev build distinction any more, testnet or mainnet.
// with_env scopes the active-env to NETWORK for the build (which resolves deps against it), then ALWAYS
// restores the found env on exit — the old inline `sui client switch` never switched back (residue class).
const build_out = await with_env(NETWORK, () =>
  execSync('sui move build --dump-bytecode-as-base64 --path ./', {
    encoding: 'utf-8',
  })
)
const cli_result = build_out.split('\n').find((l) => l.trimStart().startsWith('{'))

const { modules, dependencies } = JSON.parse(cli_result)

const [upgrade_cap] = tx.publish({
  modules,
  dependencies,
})

tx.transferObjects([upgrade_cap], keypair.getPublicKey().toSuiAddress())

console.log('publishing package...')

const result = await sui_client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: {
    showEffects: true,
    showObjectChanges: true,
  },
})

if (!result.digest) throw new Error('Failed to publish package.')

await sui_client.waitForTransaction({ digest: result.digest })

// Full manifest: the package id + every object the publish tx created (UpgradeCap, AdminWhitelist,
// OwnerCap, Publisher/Display, etc.) so the caller can hand a complete cutover spec downstream
// without a second RPC round-trip.
const published = result.objectChanges?.find((c) => c.type === 'published')
const created = (result.objectChanges ?? []).filter((c) => c.type === 'created')

console.log('package published:', result.digest)
console.log('package id:', published?.packageId)
console.log('created objects:')
for (const obj of created) {
  console.log(`  - ${obj.objectType} :: ${obj.objectId}`)
}
console.log(
  JSON.stringify(
    {
      digest: result.digest,
      network: NETWORK,
      packageId: published?.packageId,
      created: created.map((o) => ({
        type: o.objectType,
        id: o.objectId,
        owner: o.owner,
      })),
    },
    null,
    2
  )
)
console.log('==================== [ x ] ====================')
