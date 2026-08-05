#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// release_prepare.mjs — "the ceremony, serialized for the browser." Compiles all six Move packages and emits
// ONE static release_manifest.json the self-serve admin RELEASE page (packages/frontend/src/components/
// admin_release.tsx) loads and drives with the connected deployer wallet. SCRIPT ONLY — it fires NO
// chain call, needs NO key; it just runs `sui move build` (the browser can't) and writes bytecode + the plan.
//
//   bun run release:prepare                 # testnet (default)
//   NETWORK=mainnet bun run release:prepare # mainnet
//
// WHY a manifest (the honest architecture): the browser cannot compile Move, and a published package bakes its
// dependency addresses at COMPILE time — so a FRESH multi-package genesis, where each sibling gets a new id, is
// an interleaved compile→publish→stamp dance that only the CLI ceremony (ceremony.mjs) can do. What the browser
// CAN sign from static bytecode is: any UPGRADE (deps stable) and a same-lineage republish. So this manifest
// carries (1) every package's compiled bytecode for those wallet-signable paths, (2) the WHOLE plan — publish
// order, sizes, the policy/enable PTB catalog, the seed corpus counts — so the page renders the entire release
// train as a checklist that is SEEN and driven from the page. One home per step: the publish order + package graph come
// straight from ceremony_lib (the same source ceremony.mjs publishes from); the seed counts come straight from
// the seed corpus the seed scripts walk. This never forks that logic — it serializes it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

import { buildPackage, publishOrder, PKG_DEPS, CHAIN_IDS, getNetwork, MOVE_DIR, OUT } from './ceremony_lib.mjs'
import { move_sources_hash } from './move_sources_hash.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dir, '../../..')
const SEED_DIR = path.join(REPO_ROOT, 'seed/mainnet')
// Vite serves packages/frontend/public/* at the web root, so the page fetches `/release_manifest.json`. This
// works in BOTH dev and a prod build (unlike the dev-only /__publish_build middleware) — the plan is always visible.
const FRONTEND_PUBLIC = path.join(REPO_ROOT, 'packages/frontend/public')
const MANIFEST_OUT = path.join(FRONTEND_PUBLIC, 'release_manifest.json')

const b64bytes = (m) => Buffer.from(m, 'base64').length

// ── The policy + enable STEP CATALOG (display mirror of ceremony.mjs WIRING/enablePTB). These are the human
//    captions the page shows for the steps whose EXECUTION needs the live post-publish ids (publishers, the
//    resolved kiosk RULES_PKG, the shared Version/GameConfig) — captured by the ceremony/page at runtime. The
//    move targets are shown symbolically (core=aresrpg pkg, rules=resolved kiosk lineage) exactly as the
//    ceremony's own --dry-run prints them; the drift-guard test (release_prepare.test.mjs) pins them to
//    ceremony.mjs's real recorded targets so this catalog can never silently diverge. ──────────────────────
export const POLICY_STEPS = [
  {
    id: 'W1',
    name: 'Character marketplace policy',
    desc: 'create_character_policy → royalty(1000bp, min 0.01 SUI) + kiosk_lock + personal_kiosk + character_listing_rule (level gate) → share, keep cap',
    targets: [
      'core::character::create_character_policy',
      'rules::royalty_rule::add',
      'rules::kiosk_lock_rule::add',
      'rules::personal_kiosk_rule::add',
      'core::character_listing_rule::add',
    ],
  },
  {
    id: 'W2',
    name: 'Item marketplace policy',
    desc: 'create_item_policy → royalty(1000bp, min 0.01 SUI) + kiosk_lock + personal_kiosk + item_listing_rule (ghost-stack gate) → share, keep cap',
    targets: [
      'core::item::create_item_policy',
      'rules::royalty_rule::add',
      'rules::kiosk_lock_rule::add',
      'rules::personal_kiosk_rule::add',
      'core::item::add_listing_rule',
    ],
  },
  {
    id: 'W3',
    name: 'Wrapped extract policy',
    desc: 'create_extract_policy — the permanently-empty, self-sealed, self-shared extraction policy',
    targets: ['core::extract::create_extract_policy'],
  },
  {
    id: 'W4',
    name: 'Mainnet sponsor fence',
    desc: 'set_sponsor(some(station)) — CEREMONY LAW #1, set BEFORE enable while free_enabled (mainnet only)',
    network: 'mainnet',
    targets: ['core::creation::set_sponsor'],
  },
]

// Enable = the SEPARATE final flip (ceremony.mjs VERSIONED + the GameConfig freeze). foundation has no Version.
export const ENABLE_STEPS = [
  { pkg: 'spells', targets: ['spells::admin::admin_set_enabled'] },
  { pkg: 'social', targets: ['social::admin::admin_set_enabled'] },
  { pkg: 'engine', targets: ['engine::admin::admin_set_enabled'] },
  {
    pkg: 'aresrpg',
    targets: ['core::admin::admin_set_enabled', 'core::config::set_enabled'],
  },
]

// ── Seed plan — count the on-chain content the seed scripts (seed_full_corpus.mjs) mint from the corpus tree,
//    so the page shows exactly what "sync seeds" entails. Shape-driven (never a hardcoded count),
//    read from the SAME seed/mainnet/** the corpus walker loads. ────────────────────────────────────────────
function count_json_rows(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(j)) return j.length
    if (Array.isArray(j?.rows)) return j.rows.length
    if (Array.isArray(j?.sales)) return j.sales.length
    return Object.keys(j).length ? 1 : 0
  } catch {
    return 0
  }
}
// The seed corpus lives in the PRIVATE content repo, so a checkout of THIS repo alone cannot measure it. A
// zeroed plan would be a plausible lie — the manifest would advertise a 0-object release and the RELEASE page
// would render an empty seed step — so the absent-corpus path carries the prior manifest's measurement forward
// verbatim, stamped with the generation it was actually measured in, and REFUSES when there is no prior either.
function carried_seed_plan() {
  if (!fs.existsSync(MANIFEST_OUT))
    throw new Error(
      `release:prepare: ${SEED_DIR} is absent (the corpus lives in the private content repo) and there is no ` +
        `prior ${MANIFEST_OUT} to carry its measurement from — refusing to write a fabricated 0-object seed plan`
    )
  const prior = JSON.parse(fs.readFileSync(MANIFEST_OUT, 'utf8'))
  const plan = prior.seedPlan
  if (!plan?.total)
    throw new Error(
      `release:prepare: ${SEED_DIR} is absent and the prior manifest carries no measured seed plan — ` +
        `refusing to fabricate one; regenerate alongside a seed-repo checkout`
    )
  return { ...plan, carriedFrom: plan.carriedFrom ?? prior._generatedAt }
}

function seed_plan() {
  if (!fs.existsSync(SEED_DIR)) return carried_seed_plan()
  const biomes = fs.readdirSync(SEED_DIR).filter((d) => {
    try {
      return fs.statSync(path.join(SEED_DIR, d)).isDirectory()
    } catch {
      return false
    }
  })
  const acc = { items: 0, resources: 0, mobs: 0, recipes: 0, worlds: 0 }
  for (const d of biomes) {
    const b = path.join(SEED_DIR, d)
    for (const [k, f] of [
      ['items', 'items.json'],
      ['resources', 'resources.json'],
      ['mobs', 'mobs.json'],
      ['recipes', 'recipes.json'],
    ]) {
      const p = path.join(b, f)
      if (fs.existsSync(p)) acc[k] += count_json_rows(p)
    }
    if (fs.existsSync(path.join(b, 'world.json'))) acc.worlds += 1
  }
  const total = acc.items + acc.resources + acc.mobs + acc.recipes + acc.worlds
  return {
    source: 'seed/mainnet',
    present: true,
    biomes: biomes.length,
    ...acc,
    total,
    seededBy: 'node scripts/seed_full_corpus.mjs',
  }
}

// ── build ─────────────────────────────────────────────────────────────────────────────────────────────────
function sui_version() {
  try {
    return execSync('sui --version', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function main() {
  const network = getNetwork()
  const { order, corrections } = publishOrder()
  console.log(`\n=== release:prepare · network=${network} · compiling ${order.length} packages ===`)

  const packages = {}
  for (let i = 0; i < order.length; i++) {
    const pkg = order[i]
    process.stdout.write(`  [${i + 1}/${order.length}] building ${pkg} … `)
    const { modules, dependencies, digest } = buildPackage(pkg)
    const byteSize = modules.reduce((n, m) => n + b64bytes(m), 0)
    packages[pkg] = {
      order: i,
      moduleCount: modules.length,
      byteSize,
      deps: PKG_DEPS[pkg],
      digest, // the compiled-package byte array — an UPGRADE's authorize_upgrade needs it
      modules, // bytecode (b64) — wallet-signable for upgrades / stable-dep republishes
      dependencies,
    }
    console.log(`${modules.length} modules · ${(byteSize / 1024).toFixed(1)} KB`)
  }

  const moveSourcesHash = move_sources_hash()
  const manifest = {
    _kind: 'aresrpg-release-manifest',
    _generatedAt: new Date().toISOString(),
    _sui: sui_version(),
    // Staleness anchor: the exact bytes these bytecodes were compiled from. The page WARNS if the live tree
    // hash (dev `/__move_sources_hash`) diverges — regenerate (`bun run release:prepare`) after any Move edit.
    moveSourcesHash,
    network,
    chainId: CHAIN_IDS[network],
    publishOrder: order,
    corrections,
    packages,
    policySteps: POLICY_STEPS,
    enableSteps: ENABLE_STEPS,
    seedPlan: seed_plan(),
  }

  fs.mkdirSync(FRONTEND_PUBLIC, { recursive: true })
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2))
  // a copy under scripts/out for CLI reference / diffing (same home as ceremony_manifest.json)
  fs.mkdirSync(OUT, { recursive: true })
  const out_copy = path.join(OUT, 'release_manifest.json')
  fs.writeFileSync(out_copy, JSON.stringify(manifest, null, 2))
  // Both copies sit inside `bun run lint`'s prettier check (MANIFEST_OUT is committed; the out copy is a
  // working-tree artifact the move package's own check still walks), and raw JSON.stringify disagrees with
  // prettier on the trailing newline and the digest byte-array fill. Formatting here makes the artifact
  // gate-clean by construction — the alternative is a hand-run `prettier --write` someone has to remember.
  execSync(`bunx prettier --write ${MANIFEST_OUT} ${out_copy}`, { cwd: REPO_ROOT, stdio: 'ignore' })

  const totalKB = Object.values(packages).reduce((n, p) => n + p.byteSize, 0) / 1024
  console.log(`\n  policy steps: ${POLICY_STEPS.length} · enable steps: ${ENABLE_STEPS.length}`)
  console.log(
    `  seed plan: ${manifest.seedPlan.total} objects across ${manifest.seedPlan.biomes} biomes ` +
      `(${manifest.seedPlan.items} items · ${manifest.seedPlan.resources} resources · ${manifest.seedPlan.mobs} mobs · ` +
      `${manifest.seedPlan.recipes} recipes · ${manifest.seedPlan.worlds} worlds)`
  )
  console.log(`  total bytecode: ${totalKB.toFixed(1)} KB`)
  console.log(`  move-sources hash: ${moveSourcesHash.slice(0, 16)}… (staleness anchor)`)
  console.log(`\n=== manifest → ${MANIFEST_OUT} ===\n`)
}

// Run the build only when invoked directly (`node release_prepare.mjs`); importing for the drift-guard test
// (release_prepare.test.mjs) must NOT trigger six `sui move build`s.
if (import.meta.url === `file://${process.argv[1]}`) main()
