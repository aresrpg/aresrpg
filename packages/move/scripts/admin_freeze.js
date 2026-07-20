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

console.log('==================== [ FREEZING VERSION ] ====================')
console.log('network:', NETWORK)
console.log('public key:', keypair.getPublicKey().toSuiAddress())
console.log(' ')

const tx = new Transaction()

tx.moveCall({
  target: `${PACKAGE_ID}::version::admin_freeze`,
  arguments: [tx.object(VERSION), tx.object(ADMIN_CAP)],
})

console.log('freezing version...', VERSION)

const result = await sui_client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: {
    showEffects: true,
  },
})

await sui_client.waitForTransaction({ digest: result.digest })

if (result.effects?.status.error) {
  console.error('freeze failed:', result.effects.status.error)
  console.dir(result, { depth: Infinity })
  process.exit(1)
}

console.log('version frozen!')
console.log('digest:', result.digest)
console.log('==================== [ x ] ====================')
