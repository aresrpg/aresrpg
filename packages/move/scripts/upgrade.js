// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execSync } from 'child_process'
import { setTimeout } from 'timers/promises'

import { Transaction, UpgradePolicy } from '@mysten/sui/transactions'

import { NETWORK, keypair, sui_client } from './client.js'
import { with_env } from './env_guard.mjs'

const { UPGRADE_CAP, PACKAGE_ID } = process.env

if (!UPGRADE_CAP) {
  throw new Error('UPGRADE_CAP environment variable is required')
}

if (!PACKAGE_ID) {
  throw new Error('PACKAGE_ID environment variable is required')
}

// publish gate: the localnet publish_guard was retired 2026-07-14 (REDUCTION_PLAN §8) — the honest gate is `ares test` (SINGLE_FRAMEWORK_SPEC)

const tx = new Transaction()

console.log('==================== [ UPGRADING PACKAGE ] ====================')
console.log('network:', NETWORK)
console.log('public key:', keypair.getPublicKey().toSuiAddress())
console.log(' ')

// with_env scopes the active-env to NETWORK for the build, then ALWAYS restores the found env on exit —
// the old inline `sui client switch` never switched back (mainnet-residue class).
const build_out = await with_env(NETWORK, () =>
  execSync('sui move build --dump-bytecode-as-base64 --path ./', {
    encoding: 'utf-8',
  })
)
const cli_result = build_out.split('\n').find((l) => l.trimStart().startsWith('{'))

const { modules, dependencies, digest: build_digest } = JSON.parse(cli_result)

const ticket = tx.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [
    tx.object(UPGRADE_CAP),
    tx.pure.u8(UpgradePolicy.COMPATIBLE),
    tx.pure.vector('u8', build_digest),
  ],
})

const receipt = tx.upgrade({
  modules,
  dependencies,
  package: PACKAGE_ID,
  ticket,
})

tx.moveCall({
  target: '0x2::package::commit_upgrade',
  arguments: [tx.object(UPGRADE_CAP), receipt],
})

// EXPLICIT gas — REQUIRED under @mysten/sui 2.20.1. Without a set budget the SuiJsonRpcClient resolver
// runs a gas-estimation dry-run at build time, and the JSON-RPC dryRun endpoint returns
// "FeatureNotYetSupported" for the Upgrade command → tx.build() throws. Setting budget + price + an
// explicit gas coin skips that dry-run and lets the build/sign/execute proceed (execute submits to the
// fullnode, which supports upgrades). NOTE: the upgrade cannot be dry-run-verified with current tooling
// (SDK dryRun rejects Upgrade; the sui 1.74 CLI panics on testnet protocol 128) — execution is atomic
// (clean abort on compat failure), so a failed compat only costs gas, no partial state.
const me_addr = keypair.getPublicKey().toSuiAddress()
const ref_price = await sui_client.getReferenceGasPrice()
const { data: gas_coins } = await sui_client.getCoins({ owner: me_addr })
if (!gas_coins.length) throw new Error('signer has no SUI for gas')
tx.setGasBudget(BigInt(process.env.UPGRADE_GAS_BUDGET ?? 600_000_000))
tx.setGasPrice(BigInt(ref_price))
tx.setGasPayment(
  gas_coins.map((c) => ({
    objectId: c.coinObjectId,
    version: c.version,
    digest: c.digest,
  }))
)

console.log('upgrading package...', PACKAGE_ID)

const result = await sui_client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: {
    showEffects: true,
    showObjectChanges: true,
  },
})

if (result.effects?.status?.status !== 'success') {
  console.error('UPGRADE FAILED:', JSON.stringify(result.effects?.status))
  console.dir(result, { depth: 4 })
  process.exit(1)
}

// New package id = the 'published' objectChange (robust vs effects.created[0] ordering).
const published = (result.objectChanges ?? []).find(
  (c) => c.type === 'published'
)
const package_id =
  published?.packageId ?? result.effects?.created?.[0]?.reference?.objectId

// Step 3: the DungeonRegistry created by init-on-upgrade (Sui runs init for brand-new modules on
// upgrade). If it's absent, init-on-upgrade did NOT fire → HOLD the backfill/instance steps + flag cto.
const registry = (result.objectChanges ?? []).find(
  (c) =>
    c.type === 'created' &&
    (c.objectType ?? '').includes('dungeon_registry::DungeonRegistry')
)

console.log('package upgraded:', result.digest)
console.log('new package id:', package_id)
console.log(
  'DungeonRegistry (init-on-upgrade):',
  registry
    ? registry.objectId
    : '⚠️ NOT CREATED — init did not run on upgrade; HOLD steps 4-5, flag cto'
)
console.log('all created objects:')
for (const c of (result.objectChanges ?? []).filter(
  (c) => c.type === 'created'
))
  console.log('  ', c.objectId, c.objectType)
console.log('==================== [ x ] ====================')

await setTimeout(3000)

console.log('==================== [ UPDATING VERSION ] ====================')

const version_tx = new Transaction()

version_tx.moveCall({
  target: `${package_id}::version::admin_update`,
  arguments: [
    version_tx.object(process.env.VERSION),
    version_tx.object(process.env.ADMIN_CAP),
  ],
})

const migrate_result = await sui_client.signAndExecuteTransaction({
  signer: keypair,
  transaction: version_tx,
  options: {
    showEffects: true,
  },
})

await sui_client.waitForTransaction({ digest: migrate_result.digest })

if (migrate_result.effects?.status.error) {
  console.error(migrate_result.effects.status.error)
  console.dir(migrate_result, { depth: Infinity })
  process.exit(1)
}

console.log('version updated! 🎉')
console.log('digest:', migrate_result.digest)
console.log('==================== [ x ] ====================')
