// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import { NETWORK, keypair, sui_client } from './client.js'

const { VERSION, ADMIN_CAP, PACKAGE_ID } = process.env

if (!VERSION) {
  throw new Error('VERSION environment variable is required')
}

if (!ADMIN_CAP) {
  throw new Error('ADMIN_CAP environment variable is required')
}

if (!PACKAGE_ID) {
  throw new Error('PACKAGE_ID environment variable is required')
}

console.log('==================== [ UNFREEZING VERSION ] ====================')
console.log('network:', NETWORK)
console.log('public key:', keypair.getPublicKey().toSuiAddress())
console.log(' ')

const tx = new Transaction()

// admin_update migrates current_version (0 while frozen) back to PACKAGE_VERSION,
// re-enabling every version-gated function. It is the on-chain inverse of admin_freeze.
tx.moveCall({
  target: `${PACKAGE_ID}::version::admin_update`,
  arguments: [tx.object(VERSION), tx.object(ADMIN_CAP)],
})

console.log('unfreezing version...', VERSION)

const result = await sui_client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: {
    showEffects: true,
  },
})

await sui_client.waitForTransaction({ digest: result.digest })

if (result.effects?.status.error) {
  console.error('unfreeze failed:', result.effects.status.error)
  console.dir(result, { depth: Infinity })
  process.exit(1)
}

console.log('version unfrozen!')
console.log('digest:', result.digest)
console.log('==================== [ x ] ====================')
