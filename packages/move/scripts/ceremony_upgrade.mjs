// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CF-train COMPATIBLE upgrade ceremony (2026-07-06) — SDK path (authorize → upgrade → commit).
// Derived from upgrade.js with six deliberate deltas:
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
//   5. BATCH MODE (`--packages a,b,c`, 2026-08-02) — see THE GATE DEADLOCK below. Default is unchanged:
//      no `--packages` ⇒ exactly the old one-package-per-invocation behaviour, same env vars, same exits.
//   6. THE EXECUTED-TIMEOUT FIX (#2038) — the digest is printed and journalled the instant the tx
//      executes, BEFORE any finality wait; a wait that times out POLLS BY DIGEST and never resends.
//
// ── THE GATE DEADLOCK this file's batch mode exists to break (measured 2026-08-02) ──────────────────
// The per-package path cannot run twice in a row on one tree, because its own two publish gates fight:
//   (a) a successful upgrade writes bookkeeping UNDER packages/move (Published.toml + manifest);
//   (b) assert_publishable_tree (#1305) refuses ANY uncommitted change under packages/move;
//   (c) so it must be committed — which puts HEAD AHEAD of the remote edge tip;
//   (d) assert_trunk_ancestry (#1298) refuses a HEAD that is not already an ancestor of edge, and says
//       so with "There is no override."
// ⇒ package N+1 could not publish until package N's bookkeeping had LANDED on origin/edge. A nine-package
// train needed nine land-on-edge cycles. Batch mode restores the shape ceremony.mjs (the fresh-publish
// orchestrator) has always used and which produced the previous nine-pin commit in ONE landing.
//
// BOTH GATES' INTENT IS PRESERVED, and this is the whole argument for the change:
//   · The gates exist so that PUBLISHED BYTECODE only ever comes from a landed, byte-clean tree. Batch mode
//     asserts BOTH gates ONCE, over EVERY package path, BEFORE the first publish — so every module byte
//     that reaches the chain still comes from a tree that was clean and landed at that moment. The Move
//     SOURCES never change during a run; nothing recompiles from unlanded source.
//   · What trails the landing is only the GENERATED PIN RECORD, one commit for the whole set instead of
//     one landing per package. Published.toml is still written per package DURING the run — it is not
//     optional bookkeeping, it is the dependency-linkage input the next dependent's `sui move build`
//     reads, exactly as ceremony.mjs writes it per package. The MANIFEST and release.json (stamp_all)
//     are deferred to the END, which is also the first time this driver has honoured the "stamp LAST"
//     law the runbook always stated (the per-package path re-stamped after every single package).
//
// Signer: ambient CLI active-address (scripts/ceremony-signer-gate.sh is named in prose only — it does not
// exist and nothing invokes it; assert the identity by hand before a run). PRIVATE_KEY env remains an
// explicit override for exceptional runs — NEVER the primary local ~/.sui keystore.
// NOTE: upgrades cannot be dry-run (JSON-RPC dryRun rejects the Upgrade command, "FeatureNotYetSupported") —
// compat is checked atomically on execute; a compat failure aborts cleanly and only costs gas.
//
// Usage:
//   UPGRADE_CAP=0x… PKG_PATH=…/foundation  node ceremony_upgrade.mjs          # single (DEFAULT, unchanged)
//   node ceremony_upgrade.mjs --packages spells,social,engine,aresrpg         # batch, manifest-resolved
//   node ceremony_upgrade.mjs --packages all                                  # batch, every publishable pkg
import { execSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Transaction, UpgradePolicy } from '@mysten/sui/transactions'

import { NETWORK, keypair, sui_client } from './client.js'
import {
  MANIFEST_PATH,
  MOVE_DIR,
  normalizeReceipt,
  getReceipt,
  parsePublishedToml,
  bumpPublishedToml,
  resolveUpgradeTarget,
  publishOrder,
} from './ceremony_lib.mjs'
import { assert_env, assert_publishable_tree } from './env_guard.mjs'

const { UPGRADE_CAP, PACKAGE_ID, PKG_PATH } = process.env

// ── Leg resolution: one uniform shape for both modes, so the publish body below has no mode branch. ──
const argv = process.argv.slice(2)
const flag_value = (name) => {
  const inline = argv.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const packages_arg = flag_value('--packages') ?? process.env.PACKAGES
const BATCH = !!packages_arg

const read_manifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))

function resolve_legs() {
  if (!BATCH) {
    if (!UPGRADE_CAP || !PKG_PATH)
      throw new Error(
        'UPGRADE_CAP and PKG_PATH are required (PACKAGE_ID is optional — derived from the UpgradeCap, verified when passed)'
      )
    return [
      {
        name: path.basename(path.resolve(PKG_PATH)),
        pkgPath: path.resolve(PKG_PATH),
        upgradeCap: UPGRADE_CAP,
        packageIdOverride: PACKAGE_ID,
      },
    ]
  }
  // PACKAGE_ID is a single-package verification aid; it cannot mean anything across a set.
  if (PACKAGE_ID)
    throw new Error('PACKAGE_ID is meaningless in batch mode — drop it')
  const { order } = publishOrder()
  const requested =
    packages_arg.trim() === 'all'
      ? order
      : packages_arg
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
  for (const name of requested)
    if (!order.includes(name))
      throw new Error(
        `unknown package "${name}" — one of: ${order.join(', ')}`
      )
  // Always publish in dependency order regardless of the order the caller listed them: a dependent built
  // before its dependency's Published.toml is bumped would silently link the OLD lineage.
  const ordered = order.filter((p) => requested.includes(p))
  const manifest = read_manifest()
  return ordered.map((name) => {
    const cap = manifest[name]?.upgradeCap
    if (!cap)
      throw new Error(`manifest ${MANIFEST_PATH} has no "${name}".upgradeCap`)
    return {
      name,
      pkgPath: path.join(MOVE_DIR, name),
      upgradeCap: cap,
      packageIdOverride: undefined,
    }
  })
}

const legs = resolve_legs()

// ── #2038 JOURNAL: a digest that exists is gas already burned. It hits stdout and DISK the instant the tx
//    executes, before any finality wait, so a crashed/timed-out wait can never lose it. Cleared on
//    resolution; a surviving file means a previous run executed something it never recorded. ──
const PENDING_PATH = path.join(
  path.dirname(MANIFEST_PATH),
  'ceremony_upgrade_pending.json'
)
const read_pending = () =>
  fs.existsSync(PENDING_PATH)
    ? JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'))
    : {}
const write_pending = (o) => {
  if (Object.keys(o).length)
    fs.writeFileSync(PENDING_PATH, JSON.stringify(o, null, 2) + '\n')
  else if (fs.existsSync(PENDING_PATH)) fs.unlinkSync(PENDING_PATH)
}
const journal_pending = (name, digest) => {
  const p = read_pending()
  p[name] = digest
  write_pending(p)
}
const clear_pending = (name) => {
  const p = read_pending()
  delete p[name]
  write_pending(p)
}

// FAIL-CLOSED before any chain read or `sui move build` (both resolve deps/chain-ids from the ambient
// active-env): refuse unless the CLI's active-env matches NETWORK. Replaces delta-1's PROSE assumption
// ("active env is already testnet") with a real gate (seat tripwire, DECISIONS 2026-07-19 13:35/13:40).
assert_env(NETWORK)

// FAIL-CLOSED on the wrong TREE, the sibling of the wrong-network door above (#1298): the publishing
// HEAD must already be on trunk, the Move tree must match that commit byte for byte, and every package
// path — which this script otherwise compiles sight-unseen — must live inside the repository the ancestry
// proof is about (#1305 review). No override exists; a publish that is not on edge lands on edge first.
// BATCH: asserted ONCE here, over EVERY leg, BEFORE the first publish — every byte published in this run
// comes from the tree proven clean and landed at this instant (delta 5's whole argument).
assert_publishable_tree({ paths: legs.map((l) => l.pkgPath) })

// An unresolved journal means a previous run burned gas it never recorded. Proceeding would build the next
// dependent against a Published.toml that may not reflect the chain — refuse, loudly, and never re-fire.
const stale_pending = read_pending()
if (Object.keys(stale_pending).length) {
  console.error(
    `REFUSING — a previous run executed upgrade(s) it never recorded:\n${Object.entries(
      stale_pending
    )
      .map(([n, d]) => `  ${n} → digest ${d}`)
      .join('\n')}`
  )
  console.error(
    `Resolve each by DIGEST (never re-fire — the gas is already burned): read the receipt, write that\n` +
      `package's Published.toml published-at + version and manifest <pkg>.latest by hand, then delete\n` +
      `${PENDING_PATH}.`
  )
  process.exit(4)
}

// publish gate: the localnet publish_guard was retired 2026-07-14 (REDUCTION_PLAN §8) — the honest gate is `ares test` (SINGLE_FRAMEWORK_SPEC)

/** Poll an EXECUTED tx by digest. The #2038 path: a finality wait that throws never means "resend". */
async function receipt_by_digest(digest, attempts = 10) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      return await getReceipt(sui_client, digest)
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  throw new Error(
    `tx ${digest} EXECUTED but could not be re-read after ${attempts} polls: ${last?.message ?? last}. ` +
      `It is on chain — resolve it by hand. NEVER re-fire.`
  )
}

async function upgrade_one(leg) {
  const { name, pkgPath, upgradeCap, packageIdOverride } = leg

  // ── Upgrade-target derivation (delta 3): chain truth first, local record fallback, explicit id verified. ──
  let capPackage
  try {
    const { objects } = await sui_client.core.getObjects({
      objectIds: [upgradeCap],
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
  const pubFile = path.resolve(pkgPath, 'Published.toml')
  const prior = fs.existsSync(pubFile)
    ? parsePublishedToml(fs.readFileSync(pubFile, 'utf8'), NETWORK)
    : null
  const { target, source, stalePublishedToml } = resolveUpgradeTarget({
    capPackage,
    publishedAt: prior?.publishedAt,
    envPackageId: packageIdOverride,
  })
  if (stalePublishedToml)
    console.warn(
      `⚠ Published.toml published-at (${prior?.publishedAt}) is STALE vs on-chain cap.package — the post-upgrade bump reconciles it.`
    )

  console.log(
    `==================== [ UPGRADING ${name} (ceremony) ] ====================`
  )
  console.log('network:', NETWORK)
  console.log('signer:', keypair.getPublicKey().toSuiAddress())
  console.log('package (upgrade target):', target, `— derived from ${source}`)
  console.log('path:', pkgPath)

  // Build only — read-only on the ambient config (active-env == NETWORK, now assert_env-enforced above);
  // Published.toml (reconciled to the LIVE lineage, including any bump this same run already wrote for a
  // dependency) supplies the dependency linkage addresses.
  const build_out = execSync(
    `sui move build --dump-bytecode-as-base64 --path ${pkgPath}`,
    { encoding: 'utf-8' }
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
      tx.object(upgradeCap),
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
    arguments: [tx.object(upgradeCap), receipt],
  })

  // Explicit gas BUDGET (upgrades cannot be dry-run — the @mysten/sui 2.20.1 FeatureNotYetSupported workaround).
  // Gas PAYMENT + PRICE are resolved NATIVELY by the gRPC Core tx resolver from the signer's consensus
  // address-balance (no discrete Coin object needed): the old getCoins + raw `suix_getCoins` reservation-ref
  // fallback (and the GAS_COIN override that patched around it) is retired — it worked around a JSON-RPC-only
  // coin filter, and testnet JSON-RPC is dead now.
  tx.setGasBudget(BigInt(process.env.UPGRADE_GAS_BUDGET ?? 1_000_000_000))

  let result = normalizeReceipt(
    await sui_client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      include: { effects: true, objectTypes: true },
    })
  )

  // #2038 (delta 6). The tx has EXECUTED — gas is burned and the digest is the only handle on it. Print and
  // journal it BEFORE the finality wait, which is precisely where the old code lost it: `waitForTransaction`
  // threw DOMException[TimeoutError] twice in one session AFTER execution, and it sat above the bookkeeping
  // try-block, so the process died with the digest unprinted and Published.toml unwritten.
  console.log('submitted:', name, '· digest:', result.digest)
  journal_pending(name, result.digest)

  try {
    await sui_client.waitForTransaction({ digest: result.digest })
  } catch (e) {
    console.warn(
      `⚠ finality wait failed for ${result.digest} (${e?.message ?? e}) — POLLING BY DIGEST, not resending`
    )
    result = await receipt_by_digest(result.digest)
  }

  if (result.effects?.status?.status !== 'success') {
    console.error('UPGRADE FAILED:', JSON.stringify(result.effects?.status))
    console.error(`digest ${result.digest} — executed and failed; NEVER re-fire.`)
    clear_pending(name) // resolved: it executed, it failed, and it is recorded here
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
  //    failure only: fix the files by hand, NEVER re-fire the upgrade (tx-retry burn law). Published.toml
  //    is written HERE and not deferred: it is the dependency-linkage input the next leg's build reads. ──
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

  // The journal is NOT cleared here: Published.toml is written but the manifest is not, so this upgrade
  // is still only partly recorded. It clears after the manifest + stamp land, below.
  return { name, digest: result.digest, packageId: published.packageId, net }
}

// ── The run. Legs are already in dependency order; each one's Published.toml bump is visible to the next
//    leg's build. Manifest + stamp_all land ONCE, after the last package — the "stamp LAST" law. ──
const done = []
for (const leg of legs) done.push(await upgrade_one(leg))

try {
  const manifest = read_manifest()
  for (const { name, packageId } of done) {
    if (!manifest[name])
      throw new Error(`manifest ${MANIFEST_PATH} has no "${name}" package entry`)
    manifest[name].latest = packageId
    // ZoneGroupRootKey first ships in this aresrpg upgrade. Preserve its defining package forever;
    // later upgrades only move the call target and must never rewrite the type identity.
    if (name === 'aresrpg' && !manifest._type_origins?.zone_group_root)
      manifest._type_origins = {
        ...(manifest._type_origins ?? {}),
        zone_group_root: packageId,
      }
    console.log(
      `manifest: ${name}.latest → ${packageId} (release writer reads this)`
    )
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  // AUTO-STAMP, ONCE, LAST: atomically replace the one deployment config, fail-fast.
  execSync('node stamp_all.mjs', {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    stdio: 'inherit',
  })
  // Fully recorded — chain, Published.toml, manifest and release.json now agree. Only now is the journal
  // resolved; a survivor past this point means a run stopped with an upgrade only partly written down.
  for (const { name } of done) clear_pending(name)
} catch (e) {
  console.error(
    `CRITICAL — ${done.length} upgrade(s) SUCCEEDED on-chain but manifest/stamp FAILED: ${e?.message ?? e}`
  )
  for (const { name, digest, packageId } of done)
    console.error(`  ${name} digest ${digest} → ${packageId}`)
  console.error(
    'Record them BY HAND (manifest `<pkg>.latest`, then re-run stamp_all) before any dependent build/release write. NEVER re-fire an upgrade.'
  )
  process.exit(3)
}

console.log('\n──── per-package actual cost ────')
let total = 0n
for (const { name, packageId, digest, net } of done) {
  total += net
  console.log(
    `  ${name.padEnd(11)} ${String(net).padStart(12)} MIST  ${(Number(net) / 1e9).toFixed(6)} SUI  ${digest}  → ${packageId}`
  )
}
console.log(
  `  ${'TOTAL'.padEnd(11)} ${String(total).padStart(12)} MIST  ${(Number(total) / 1e9).toFixed(6)} SUI  (${done.length} package(s))`
)
console.log('==================== [ x ] ====================')
