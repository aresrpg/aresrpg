// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CF-train COMPATIBLE upgrade ceremony (2026-07-06) — SDK path (authorize → upgrade → commit), one package
// per invocation. Derived from upgrade.js with four deliberate deltas:
//   1. NO `sui client switch` — never writes the ambient client config; the build reads it read-only.
//   2. NO version::admin_update — this train is ADDITIVE-ONLY (CTO no-bump ruling): live Version object == 4
//      == PACKAGE_VERSION const, so gated fns pass on both old and new package ids; a bump would abort
//      (`current_version < PACKAGE_VERSION` is false) AND brick the live frontend until cutover.
//   3. Parameterized per package: PKG_PATH + UPGRADE_CAP env vars. PACKAGE_ID is OPTIONAL and VERIFIED —
//      the upgrade TARGET is DERIVED from ground truth (on-chain UpgradeCap.package, Published.toml
//      published-at fallback). 2026-07-13 wave-2a incident: a type-origin PACKAGE_ID passed as the target
//      after one prior upgrade would abort ON-CHAIN (PackageIDDoesNotMatch) and burn gas — a mismatching
//      explicit PACKAGE_ID now refuses PRE-FLIGHT instead (resolveUpgradeTarget, ceremony_lib.mjs).
//   4. Post-success lineage bookkeeping (same incident, other half): bumps Published.toml published-at/
//      version and stamps manifest `<pkg>.latest` — so the NEXT dependent build links the fresh lineage
//      and stamp_all writes the real LATEST ids into release.json instead of retaining the type origin.
// Signer: ambient CLI active-address, signer-gate-asserted (scripts/ceremony-signer-gate.sh pre; expected
// identity per DECISIONS 2026-07-18 15:03 = server-aresrpg). PRIVATE_KEY env remains an explicit override
// for exceptional runs — NEVER the primary local ~/.sui keystore.
// NOTE: upgrades cannot be dry-run (JSON-RPC dryRun rejects the Upgrade command, "FeatureNotYetSupported") —
// compat is checked atomically on execute; a compat failure aborts cleanly and only costs gas.
import { execSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction, UpgradePolicy } from '@mysten/sui/transactions'

import { NETWORK, keypair, sui_client } from './client.js'
import {
  MANIFEST_PATH,
  normalizeReceipt,
  parsePublishedToml,
  bumpPublishedToml,
  resolveUpgradeTarget,
} from './ceremony_lib.mjs'
import { assert_env } from './env_guard.mjs'

const { UPGRADE_CAP, PACKAGE_ID, PKG_PATH } = process.env
if (!UPGRADE_CAP || !PKG_PATH)
  throw new Error(
    'UPGRADE_CAP and PKG_PATH are required (PACKAGE_ID is optional — derived from the UpgradeCap, verified when passed)'
  )

// FAIL-CLOSED before any chain read or `sui move build` (both resolve deps/chain-ids from the ambient
// active-env): refuse unless the CLI's active-env matches NETWORK. Replaces delta-1's PROSE assumption
// ("active env is already testnet") with a real gate (seat tripwire, DECISIONS 2026-07-19 13:35/13:40).
assert_env(NETWORK)

// publish gate: the localnet publish_guard was retired 2026-07-14 (REDUCTION_PLAN §8) — the honest gate is `ares test` (SINGLE_FRAMEWORK_SPEC)

// ── Upgrade-target derivation (delta 3): chain truth first, local record fallback, explicit id verified. ──
let capPackage
try {
  const { objects } = await sui_client.core.getObjects({
    objectIds: [UPGRADE_CAP],
    include: { json: true },
  })
  const cap = objects?.[0]
  if (cap instanceof Error) throw cap
  capPackage = cap?.json?.package
  if (!capPackage)
    console.warn(
      '⚠ UpgradeCap content not decoded by the node — falling back to Published.toml published-at'
    )
} catch (e) {
  console.warn(
    `⚠ UpgradeCap read failed (${e?.message ?? e}) — falling back to Published.toml published-at`
  )
}
const pubFile = path.resolve(PKG_PATH, 'Published.toml')
const prior = fs.existsSync(pubFile)
  ? parsePublishedToml(fs.readFileSync(pubFile, 'utf8'), NETWORK)
  : null
const { target, source, stalePublishedToml } = resolveUpgradeTarget({
  capPackage,
  publishedAt: prior?.publishedAt,
  envPackageId: PACKAGE_ID,
})
if (stalePublishedToml)
  console.warn(
    `⚠ Published.toml published-at (${prior?.publishedAt}) is STALE vs on-chain cap.package — the post-upgrade bump reconciles it.`
  )

console.log(
  '==================== [ UPGRADING PACKAGE (ceremony) ] ===================='
)
console.log('network:', NETWORK)
console.log('signer:', keypair.getPublicKey().toSuiAddress())
console.log('package (upgrade target):', target, `— derived from ${source}`)
console.log('path:', PKG_PATH)

// Build only — read-only on the ambient config (active-env == NETWORK, now assert_env-enforced above);
// Published.toml (reconciled
// to the LIVE lineage) supplies the dependency linkage addresses.
const build_out = execSync(
  `sui move build --dump-bytecode-as-base64 --path ${PKG_PATH}`,
  {
    encoding: 'utf-8',
  }
)
const json_line = build_out
  .split('\n')
  .find((l) => l.trimStart().startsWith('{'))
const { modules, dependencies, digest: build_digest } = JSON.parse(json_line)
console.log('modules:', modules.length, '| deps:', dependencies)

const tx = new Transaction()
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
  package: target,
  ticket,
})
tx.moveCall({
  target: '0x2::package::commit_upgrade',
  arguments: [tx.object(UPGRADE_CAP), receipt],
})

// Explicit gas BUDGET (upgrades cannot be dry-run — the @mysten/sui 2.20.1 FeatureNotYetSupported workaround).
// Gas PAYMENT + PRICE are resolved NATIVELY by the gRPC Core tx resolver from the signer's consensus
// address-balance (no discrete Coin object needed): the old getCoins + raw `suix_getCoins` reservation-ref
// fallback (and the GAS_COIN override that patched around it) is retired — it worked around a JSON-RPC-only
// coin filter, and testnet JSON-RPC is dead now.
tx.setGasBudget(BigInt(process.env.UPGRADE_GAS_BUDGET ?? 1_000_000_000))

const result = normalizeReceipt(
  await sui_client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    include: { effects: true, objectTypes: true },
  })
)
await sui_client.waitForTransaction({ digest: result.digest })

if (result.effects?.status?.status !== 'success') {
  console.error('UPGRADE FAILED:', JSON.stringify(result.effects?.status))
  process.exit(1)
}

const published = (result.objectChanges ?? []).find(
  (c) => c.type === 'published'
)
const gas = result.effects.gasUsed
const net =
  BigInt(gas.computationCost) +
  BigInt(gas.storageCost) -
  BigInt(gas.storageRebate)
console.log('UPGRADE_OK')
console.log('digest:', result.digest)
console.log('new package id:', published?.packageId)
console.log('gas net (MIST):', net.toString(), `(${Number(net) / 1e9} SUI)`)
for (const c of (result.objectChanges ?? []).filter(
  (c) => c.type === 'created'
))
  console.log('created:', c.objectId, c.objectType)

// ── Post-success lineage bookkeeping (delta 4). The upgrade EXECUTED — a failure below is a RECORDING
//    failure only: fix the files by hand, NEVER re-fire the upgrade (tx-retry burn law). ──
try {
  if (!published?.packageId)
    throw new Error('no `published` objectChange in the receipt')
  fs.writeFileSync(
    pubFile,
    bumpPublishedToml(
      fs.readFileSync(pubFile, 'utf8'),
      NETWORK,
      published.packageId
    )
  )
  console.log(
    `Published.toml: published-at → ${published.packageId} (version ${prior?.version} → ${(prior?.version ?? 0) + 1})`
  )
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const key = path.basename(path.resolve(PKG_PATH))
  if (!manifest[key])
    throw new Error(`manifest ${MANIFEST_PATH} has no "${key}" package entry`)
  manifest[key].latest = published.packageId
  // ZoneGroupRootKey first ships in this aresrpg upgrade. Preserve its defining package forever;
  // later upgrades only move the call target and must never rewrite the type identity.
  if (key === 'aresrpg' && !manifest._type_origins?.zone_group_root)
    manifest._type_origins = {
      ...(manifest._type_origins ?? {}),
      zone_group_root: published.packageId,
    }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`manifest: ${key}.latest → ${published.packageId} (release writer reads this)`)
  // AUTO-STAMP: atomically replace the one deployment config, fail-fast.
  execSync('node stamp_all.mjs', {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    stdio: 'inherit',
  })
} catch (e) {
  console.error(
    `CRITICAL — upgrade SUCCEEDED on-chain (digest ${result.digest}, new id ${published?.packageId}) ` +
      `but lineage bookkeeping FAILED: ${e?.message ?? e}`
  )
  console.error(
    'Record it BY HAND (Published.toml published-at + version, manifest `<pkg>.latest`) before any dependent build/release write. NEVER re-fire the upgrade.'
  )
  process.exit(3)
}
console.log('==================== [ x ] ====================')
