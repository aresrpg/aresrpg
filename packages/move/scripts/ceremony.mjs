#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ceremony.mjs — the 7-package PUBLISH CEREMONY orchestrator (S-46 merge + the 07-11/12 size splits; publishes foundation → spells → social → engine → aresrpg → kolizeum → forgemagie). SCRIPT ONLY:
// nothing here fires a real publish/sign/faucet unless EXECUTE mode is explicitly requested; `--dry-run` prints the
// whole plan with ZERO chain calls (no key required). Only an explicit execute run fires the real transactions.
//
//   node scripts/ceremony.mjs --dry-run                 # print the plan (order · every PTB's targets · assertions)
//   PRIVATE_KEY=… scripts/ceremony.mjs --network testnet # PUBLISH foundation → aresrpg + POLICIES + ASSERT
//   PRIVATE_KEY=… scripts/ceremony.mjs --enable          # the SEPARATE final `enabled` flip (one Version + GameConfig)
//   … --network mainnet --station 0x<gas-station>        # mainnet: set_sponsor(some(station)) runs before enable
//
// S-46: the cap-deposit wiring (old W1–W7: ExtensionCaps, CreatorCaps, custody registries) is DEAD — the merged
// package has NO cross-package authority machinery. What remains: the marketplace/extract POLICIES + the mainnet
// sponsor fence, then assertions (policies attached · ONE Version dark · GameConfig disabled · zero loose
// authority), then --enable flips the one Version + the global GameConfig freeze.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'

import {
  MOVE_DIR,
  PKG_DEPS,
  ROYALTY_BP,
  ROYALTY_MIN,
  OUT,
  MANIFEST_PATH,
  LEGACY_ALIASES,
  publishOrder,
  syntheticManifest,
  getClient,
  getSigner,
  getNetwork,
  run,
  buildPackage,
  clearPublished,
  writePublished,
  classify,
  resolvePublishers,
  resolveFightShards,
  resolveRulesPkg,
  isSome,
} from './ceremony_lib.mjs'
import { assert_publishable_tree, with_env } from './env_guard.mjs'

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// WIRING PTBs — S-46: only the POLICY layer + the mainnet sponsor fence. `(tx, M) => void` builders; real mode
// executes, dry-run records their moveCall targets against a synthetic manifest (no chain).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
const o = (tx, id) => tx.object(id)
const createdChange = (r, needle) =>
  (r.objectChanges || []).find(
    (c) => c.type === 'created' && (c.objectType || '').includes(needle)
  )
const createdId = (r, needle) => createdChange(r, needle)?.objectId
// Fold a marketplace-policy PTB's created shared TransferPolicy + kept TransferPolicyCap into the manifest.
// S-51a: the policy's initial_shared_version rides along — TransferPolicies are shared in THIS wiring PTB
// (never the publish), so classify()'s capture can't see them; every buy/mint pays the resolve otherwise.
function capturePolicy(r, M, kind) {
  const policy = createdChange(r, '0x2::transfer_policy::TransferPolicy<')
  const shared_v = policy?.owner?.Shared?.initial_shared_version // String(): JSON-RPC wavers number/string
  ;(M.policies ||= {})[kind] = {
    policy: policy?.objectId,
    initial_shared_version: shared_v == null ? null : String(shared_v),
    cap: createdId(r, '0x2::transfer_policy::TransferPolicyCap<'),
  }
}

const WIRING = [
  {
    name: 'W1 · character marketplace policy + rules',
    desc: 'create_character_policy → royalty(1000bp,min>0)+kiosk_lock+personal_kiosk (RULES_PKG) + character_listing_rule::add → share policy, keep cap',
    build(tx, M) {
      policyPTB(
        tx,
        M,
        'character',
        `${M.aresrpg.pkg}::character::Character`,
        M.aresrpg.publishers.character,
        true
      )
    },
    capture: (r, M) => capturePolicy(r, M, 'character'),
  },
  {
    name: 'W2 · item marketplace policy + rules',
    desc: 'create_item_policy → royalty(1000bp,min>0)+kiosk_lock+personal_kiosk (RULES_PKG) + item::add_listing_rule (ghost-stack gate) → share policy, keep cap',
    build(tx, M) {
      policyPTB(
        tx,
        M,
        'item',
        `${M.aresrpg.pkg}::item::Item`,
        M.aresrpg.publishers.item,
        true
      )
    },
    capture: (r, M) => capturePolicy(r, M, 'item'),
  },
  {
    name: 'W3 · wrapped extract policy',
    desc: 'extract::create_extract_policy — the permanently-empty, self-sealed, self-shared extraction policy',
    build(tx, M) {
      tx.moveCall({
        target: `${M.aresrpg.pkg}::extract::create_extract_policy`,
        arguments: [o(tx, M.aresrpg.publishers.item), o(tx, M.aresrpg.version)],
      })
    },
    capture: (r, M) => {
      // S-51b: ride the initial_shared_version exactly like capturePolicy — the wrapper self-shares in THIS
      // PTB, and the SDK's EXTRACT_POLICY static ref (aresrpg_shared_ref) needs the pair stamped together.
      const wrapper = createdChange(r, '::extract::ItemExtractPolicy')
      const shared_v = wrapper?.owner?.Shared?.initial_shared_version
      ;(M.policies ||= {}).extract = {
        policy: wrapper?.objectId,
        initial_shared_version: shared_v == null ? null : String(shared_v),
      }
    },
  },
  {
    name: 'W4 · set_sponsor(some(station))',
    desc: 'CEREMONY LAW #1 — the free-char sponsor fence, set BEFORE enable while free_enabled (testnet runs sponsor-none)',
    network: 'mainnet',
    build(tx, M) {
      // 2026-07-13 gifting split: creation.move (and its shared Creation gate) live in aresrpg_gifting now.
      tx.moveCall({
        target: `${M.gifting.pkg}::creation::set_sponsor`,
        arguments: [
          o(tx, M.aresrpg.admin),
          o(tx, M.gifting.shared.Creation),
          tx.pure(bcs.option(bcs.Address).serialize(M._station).toBytes()),
          o(tx, M.aresrpg.version),
        ],
      })
    },
  },
  {
    name: 'W5 · forge brand + CrushBoard',
    desc: 'pin the forgemagie brand in GameConfig → create + share the one CrushBoard required by crush/scribe',
    build(tx, M) {
      tx.moveCall({
        target: `${M.aresrpg.pkg}::config::set_forge_brand`,
        typeArguments: [`${M.forgemagie.pkg}::forgemagie::Forge`],
        arguments: [
          o(tx, M.aresrpg.admin),
          o(tx, M.aresrpg.shared.GameConfig),
          o(tx, M.aresrpg.version),
        ],
      })
      tx.moveCall({
        target: `${M.forgemagie.pkg}::forgemagie::create_board`,
        arguments: [o(tx, M.aresrpg.admin), o(tx, M.aresrpg.version)],
      })
    },
    capture(r, M) {
      classify('forgemagie', r, M)
      if (
        !M.forgemagie.shared?.CrushBoard ||
        !M.forgemagie.shared_versions?.CrushBoard
      )
        throw new Error('W5: create_board receipt has no shared CrushBoard id/version')
    },
  },
]

/** Shared marketplace-policy PTB body (item + character); `listing` adds the per-kind listing rule
 *  (character → character_listing_rule level gate; item → item::add_listing_rule zero-amount/ghost gate). */
function policyPTB(tx, M, kind, type, publisher, listing) {
  const fn =
    kind === 'character' ? 'create_character_policy' : 'create_item_policy'
  const [pol, cap] = tx.moveCall({
    target: `${M.aresrpg.pkg}::${kind}::${fn}`,
    arguments: [o(tx, publisher), o(tx, M.aresrpg.version)],
  })
  tx.moveCall({
    target: `${M._rules}::royalty_rule::add`,
    typeArguments: [type],
    arguments: [pol, cap, tx.pure.u16(ROYALTY_BP), tx.pure.u64(ROYALTY_MIN)],
  })
  tx.moveCall({
    target: `${M._rules}::kiosk_lock_rule::add`,
    typeArguments: [type],
    arguments: [pol, cap],
  })
  tx.moveCall({
    target: `${M._rules}::personal_kiosk_rule::add`,
    typeArguments: [type],
    arguments: [pol, cap],
  })
  if (listing)
    tx.moveCall({
      // character → character_listing_rule::add (§17.30 level gate); item → item::add_listing_rule (the
      // ghost-stack gate, folded into `item` at the republish restructure — its module went away, the door did
      // not). Both are non-generic type-specific fns (no typeArguments).
      target:
        kind === 'item'
          ? `${M.aresrpg.pkg}::item::add_listing_rule`
          : `${M.aresrpg.pkg}::${kind}_listing_rule::add`,
      arguments: [pol, cap],
    })
  if (kind === 'item')
    tx.moveCall({
      // lot_rule::add (the split is hardcoded by design): the D755 forced-lot gate
      // {1,10,100,1000 — immutable constants in lot_rule.move} attaches at POLICY BIRTH, never as a
      // separate manual step a ceremony can forget. Item policy only; uniques pass inside the rule.
      target: `${M.aresrpg.pkg}::item::add_lot_rule`,
      arguments: [pol, cap],
    })
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`0x2::transfer_policy::TransferPolicy<${type}>`],
    arguments: [pol],
  })
  tx.transferObjects([cap], tx.pure.address(M._signer)) // keep the TransferPolicyCap (fee-withdraw authority)
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ENABLE — the SEPARATE final flip: the ONE package Version + the GLOBAL GameConfig freeze.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
const VERSIONED = ['spells', 'social', 'engine', 'aresrpg'] // foundation has no Version
function enablePTB(tx, M, pkg) {
  tx.moveCall({
    target: `${M[pkg].pkg}::admin::admin_set_enabled`,
    arguments: [o(tx, M[pkg].admin), o(tx, M[pkg].version), tx.pure.bool(true)],
  })
  if (pkg === 'aresrpg') {
    tx.moveCall({
      target: `${M.aresrpg.pkg}::config::set_enabled`,
      arguments: [
        o(tx, M.aresrpg.admin),
        o(tx, M.aresrpg.shared.GameConfig),
        tx.pure.bool(true),
      ],
    })
    // 2026-07-13 gifting/dungeon size-split: pin the two sibling witnesses so their brand-gated core doors open
    // post-publish (gift/airdrop/loot_box/consume/pool/creation mint+heal+character-mint; dungeon's two fight
    // doors). Guarded on id presence so the pre-publish dry-run preview never records an `undefined::…` target.
    if (M.gifting?.pkg)
      tx.moveCall({
        target: `${M.aresrpg.pkg}::config::set_gifting_brand`,
        typeArguments: [`${M.gifting.pkg}::gifting::Gifting`],
        arguments: [o(tx, M.aresrpg.admin), o(tx, M.aresrpg.shared.GameConfig), o(tx, M.aresrpg.version)],
      })
    if (M.dungeon?.pkg)
      tx.moveCall({
        target: `${M.aresrpg.pkg}::config::set_dungeon_brand`,
        typeArguments: [`${M.dungeon.pkg}::dungeon::Dungeon`],
        arguments: [o(tx, M.aresrpg.admin), o(tx, M.aresrpg.shared.GameConfig), o(tx, M.aresrpg.version)],
      })
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ASSERTIONS — post-wiring RPC reads (real mode). Each returns { label, pass, detail }. Dry-run prints labels.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
const ASSERTIONS = [
  'S-46 authority zero: NO ExtensionCap / CreatorCap / custody-registry types exist in the merged package — nothing to wire, nothing loose (the types are gone at compile time)',
  'Policies attached: character policy (royalty+lock+personal+listing) + item policy (royalty[min>0]+lock+personal+item::add_listing_rule ghost gate) shared; wrapped ItemExtractPolicy shared; both TransferPolicyCaps at the signer',
  'DARK: the ONE Version enabled=false + GameConfig.enabled=false (until --enable); domain kill-switch mask ships ALL-ON',
]
async function runAssertions(client, M) {
  const results = []
  const content = async (id) =>
    (await client.getObject({ objectId: id, include: { json: true } })).object
      .json
  // A1 — policies exist + shared
  {
    const ok = !!(
      M.policies?.character?.policy &&
      M.policies?.item?.policy &&
      M.policies?.extract?.policy
    )
    results.push({
      label: 'A1 policies (character + item + extract) captured',
      pass: ok,
      detail: JSON.stringify(M.policies || {}),
    })
  }
  // A2 — the one Version dark + GameConfig disabled
  {
    const v = await content(M.aresrpg.version)
    const gc = await content(M.aresrpg.shared.GameConfig)
    const pass = v.enabled === false && gc.enabled === false
    results.push({
      label: 'A2 DARK (Version + GameConfig)',
      pass,
      detail: `version.enabled=${v.enabled} gameConfig.enabled=${gc.enabled} domains=${gc.domain_enabled}`,
    })
  }
  // A3 — core objects accounted
  {
    const pass = !!(
      M.aresrpg.admin &&
      M.aresrpg.version &&
      M.aresrpg.upgradeCap &&
      M.aresrpg.shared.GameConfig &&
      M.engine.shared.FightRegistryShards?.length &&
      M.engine.shared.FightLatchShards?.length &&
      // 2026-07-13 gifting split: pool.move's init (and its shared PoolRegistry) live in aresrpg_gifting now.
      M.gifting.shared.PoolRegistry
    )
    results.push({
      label:
        'A3 core objects accounted (admin/version/upgradeCap/GameConfig/FightRegistryShards/FightLatchShards/PoolRegistry)',
      pass,
      detail: `admin=${M.aresrpg.admin} version=${M.aresrpg.version}`,
    })
  }
  return results
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// DRY-RUN plan printer — records each PTB's moveCall targets against a synthetic manifest (zero chain calls).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
function recordTargets(buildFn, M) {
  const tx = new Transaction()
  const targets = []
  const orig = tx.moveCall.bind(tx)
  tx.moveCall = (c) => {
    targets.push(c.target)
    return orig(c)
  }
  buildFn(tx, M)
  return targets
}
function printPlan() {
  const net = getNetwork()
  const M = syntheticManifest()
  const { order, corrections } = publishOrder()
  console.log(
    '\n========================= [ CEREMONY PLAN — DRY RUN · zero chain calls ] ========================='
  )
  console.log(
    `network=${net}   (RULES_PKG resolved at runtime from items' linked kiosk dep; shown here as ${M._rules})`
  )

  console.log(
    '\n────────── [ 1 · PUBLISH CHAIN (dependency / topological order) ] ──────────'
  )
  order.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p}`))
  if (corrections.length) {
    console.log('  ⚠ TICKET-ORDER CORRECTIONS (topological):')
    for (const c of corrections) console.log(`     - ${c}`)
  }
  console.log(
    '  (foundation ships no shared objects/Version — publish only; aresrpg ships DARK.)'
  )

  console.log(
    '\n────────── [ 2 · WIRING PTBs (composed; executed only outside --dry-run) ] ──────────'
  )
  for (const w of WIRING) {
    const only = w.network ? `  [${w.network} only]` : ''
    console.log(`\n  ${w.name}${only}`)
    console.log(`    ${w.desc}`)
    for (const t of recordTargets(w.build, M)) console.log(`      → ${t}`)
  }

  console.log(
    '\n────────── [ 3 · POST-WIRING ASSERTIONS (RPC reads) ] ──────────'
  )
  for (const a of ASSERTIONS) console.log(`  ✓ ${a}`)

  console.log(
    '\n────────── [ 4 · ENABLE (separate --enable invocation; one PTB per package, DARK until then) ] ──────────'
  )
  for (const p of VERSIONED) {
    console.log(`  ${p}:`)
    for (const t of recordTargets((tx, m) => enablePTB(tx, m, p), M))
      console.log(`      → ${t}`)
  }
  if (net === 'mainnet')
    console.log(
      '  (mainnet --enable guards: refuse to enable while free_enabled && Creation.sponsor == none)'
    )

  console.log('\n────────── [ 5 · MANIFEST ] ──────────')
  console.log(`  execute mode writes ${MANIFEST_PATH}`)
  console.log(
    '    per package: { package_id, upgrade_cap, admin, version, shared{registries/configs/gates}, publishers, displays } + policies'
  )
  console.log(
    '\n========================= [ END PLAN — nothing executed ] =========================\n'
  )
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// EXECUTE — publish the train, wire, assert, write the manifest. (Execute-mode only; not reachable from --dry-run.)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
async function doCeremony() {
  // publish gate: the localnet publish_guard was retired 2026-07-14 (REDUCTION_PLAN §8) — the honest gate is `ares test` (SINGLE_FRAMEWORK_SPEC)
  const net = getNetwork()
  const client = getClient(net)
  const signer = getSigner()
  const me = signer.getPublicKey().toSuiAddress()
  console.log(`\n=== PUBLISH CEREMONY · network=${net} · signer=${me} ===`)
  // with_env scopes the CLI to `net` and ALWAYS restores the found active-env on exit (switch-back law) —
  // the raw self-switch here used to leave the CLI on the ceremony's env (mainnet-residue class).
  await with_env(net, () => runCeremony({ net, client, signer, me }))
}

async function runCeremony({ net, client, signer, me }) {
  const { order, corrections } = publishOrder()
  if (corrections.length) {
    console.log('TICKET-ORDER CORRECTIONS applied:')
    corrections.forEach((c) => console.log('  - ' + c))
  }

  // --skip a,b,c — RESUME support: packages already LIVE and source-current keep their published ids; their
  // manifest entries load from the previous checkpoint (scripts/out/ceremony_manifest.json). Used after a
  // mid-train failure: skip what succeeded, republish what changed.
  const skip = (process.env.CEREMONY_SKIP || '').split(',').filter(Boolean)
  const M = { _network: net, _signer: me }
  if (skip.length) {
    const prev = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    for (const pkg of skip) {
      if (!prev[pkg]?.pkg)
        throw new Error(
          `--skip ${pkg}: no manifest entry from a previous run — cannot resume`
        )
      M[pkg] = prev[pkg]
      console.log(`  (skip ${pkg} — live at ${prev[pkg].pkg})`)
    }
  }
  fs.mkdirSync(OUT, { recursive: true })
  for (const pkg of order) {
    if (skip.includes(pkg)) continue
    console.log(`\n--- publishing ${pkg} ---`)
    clearPublished(pkg, net) // strip any stale [published.<net>] so the fresh build is treated as unpublished
    const { modules, dependencies, digest } = buildPackage(pkg)
    const tx = new Transaction()
    const [cap] = tx.publish({ modules, dependencies })
    tx.transferObjects([cap], tx.pure.address(me))
    const r = await run(client, signer, `publish:${pkg}`, tx, { derive: false }) // SDK auto-budget (mirror publish.js)
    const e = (M[pkg] = classify(pkg, r, M)) // fold created objects into the manifest
    e.dependencies = dependencies
    e.buildDigest = digest
    writePublished(pkg, net, {
      publishedAt: e.pkg,
      originalId: e.pkg,
      upgradeCap: e.upgradeCap,
    })
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(M, null, 2)) // checkpoint after every publish (resumable)
    console.log(`  ${pkg} pkg=${e.pkg}`)
  }

  await resolvePublishers(client, M)
  await resolveFightShards(client, M) // both fight families, each ordered by its own on-chain index
  M._rules = resolveRulesPkg(M)
  M._station = process.env.SPONSOR_STATION || null
  for (const a of LEGACY_ALIASES) M[a] = M.aresrpg // seed compatibility aliases; release.json stays semantic
  M.fight = M.engine // fight targets live in the engine package
  // This type is present in the current fresh-publish source, so its immutable defining id is the origin.
  M._type_origins = { zone_group_root: M.aresrpg.pkg }
  console.log(`\nRULES_PKG (from aresrpg linked kiosk dep) = ${M._rules}`)
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(M, null, 2))

  console.log('\n=== WIRING ===')
  for (const w of WIRING) {
    if (w.network && w.network !== net) {
      console.log(`  (skip ${w.name} — ${w.network} only)`)
      continue
    }
    if (w.name.startsWith('W4')) {
      if (!M._station)
        throw new Error(
          'mainnet: --station / SPONSOR_STATION required for set_sponsor (CEREMONY LAW #1)'
        )
    }
    const tx = new Transaction()
    w.build(tx, M)
    const r = await run(client, signer, w.name.split(' ')[0], tx)
    w.capture?.(r, M)
  }

  console.log('\n=== ASSERTIONS ===')
  const results = await runAssertions(client, M)
  let allPass = true
  for (const a of results) {
    console.log(`  ${a.pass ? 'PASS' : 'FAIL'} ${a.label} — ${a.detail}`)
    allPass &&= a.pass
  }
  if (!allPass)
    throw new Error(
      'CEREMONY ASSERTIONS FAILED — see above (packages published + wired; DO NOT --enable)'
    )

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(M, null, 2) + '\n')
  // The publisher owns deployment config generation. stamp_all validates the complete
  // manifest before replacing release.json with one adjacent-temp-file rename.
  execSync('node stamp_all.mjs', {
    cwd: new URL('.', import.meta.url),
    stdio: 'inherit',
  })
  console.log(
    `\n=== CEREMONY COMPLETE · manifest=${MANIFEST_PATH} · packages DARK until --enable ===`
  )
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ENABLE — the separate final flip. Reads the manifest; mainnet guards the sponsor fence before items.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
async function doEnable() {
  const net = getNetwork()
  const client = getClient(net)
  const signer = getSigner()
  if (!fs.existsSync(MANIFEST_PATH))
    throw new Error(`no manifest at ${MANIFEST_PATH} — run the ceremony first`)
  const M = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  M._signer = signer.getPublicKey().toSuiAddress()
  // switch-back law (see runCeremony): scope to `net`, restore the found active-env on exit.
  await with_env(net, () => runEnable({ net, client, signer, M }))
}

async function runEnable({ net, client, signer, M }) {
  if (net === 'mainnet') {
    // CEREMONY LAW #1 — fail-closed sponsor fence
    const cr = (
      await client.getObject({
        objectId: M.gifting.shared.Creation, // gifting split: the Creation gate is shared by aresrpg_gifting's init
        include: { json: true },
      })
    ).object.json
    if (cr.free_enabled === true && !isSome(cr.sponsor))
      throw new Error(
        'mainnet REFUSE: free_enabled && Creation.sponsor == none — run W4 set_sponsor(station) before enabling (CEREMONY LAW #1)'
      )
  }

  console.log(`\n=== ENABLE · network=${net} ===`)
  for (const pkg of VERSIONED) {
    const tx = new Transaction()
    enablePTB(tx, M, pkg)
    await run(client, signer, `enable:${pkg}`, tx)
  }
  console.log('=== ALL PACKAGES ENABLED (live) ===')
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const argv = process.argv.slice(2)
  const flag = (n) => argv.includes(n)
  const val = (n) => {
    const eq = argv.find((x) => x.startsWith(n + '='))
    if (eq) return eq.slice(n.length + 1)
    const i = argv.indexOf(n)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')
      ? argv[i + 1]
      : null
  }
  const network = val('--network')
  if (network) process.env.NETWORK = network
  const station = val('--station')
  if (station) process.env.SPONSOR_STATION = station
  const skip = val('--skip')
  if (skip) process.env.CEREMONY_SKIP = skip

  if (flag('--dry-run')) return printPlan()

  // ── EXECUTE MODE STARTS HERE (#1305 review, CRITICAL) ───────────────────────────────────────
  // Everything below this line signs chain transactions: doCeremony publishes nine packages,
  // doEnable flips the live switch. Both used to reach `tx.publish` from any branch, any commit,
  // any working tree — the ancestry guard existed but this orchestrator, the one the ceremony
  // actually runs, never called it. It is armed HERE, at the single shared entry, before the
  // client, the signer, the build or the enable path is touched, so no future door can be added
  // below it and miss it. `--dry-run` returns above, untouched and unguarded — it signs nothing.
  assert_publishable_tree({
    paths: Object.keys(PKG_DEPS).map((pkg) => path.join(MOVE_DIR, pkg)),
  })

  if (flag('--enable')) return doEnable()
  return doCeremony()
}
main().catch((e) => {
  console.error('\nCEREMONY ERROR:', e.message)
  process.exit(1)
})
