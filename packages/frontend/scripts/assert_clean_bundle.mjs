#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// POST-BUILD bundle-cleanliness gate (2026-07-14). The `prebuild` secret-leak gate
// (scripts/check-constraints.sh) scans tracked SOURCE but deliberately excludes dist/ — so it is
// structurally BLIND to a secret that Vite BAKES into the client bundle from a VITE_* env var.
// That blind spot shipped once: a local .env / .env.production rode into the Vercel build and Vite
// inlined VITE_DEV_KEY (a real suiprivkey) + the retired `assets.aresrpg.world` host into the public
// JS. This gate closes it by asserting the RESOLVED bundle (the memory law: acceptance = resolved-
// value assertion, never a source grep). Runs automatically as `postbuild` after `vite build`, so a
// poisoned bundle FAILS the deploy instead of shipping.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

// Each rule: a forbidden pattern that must NEVER appear in a shipped bundle, + why.
const FORBIDDEN = [
  {
    re: /suiprivkey1[a-z0-9]{20,}/,
    why: 'a Sui private key was inlined into the bundle (a VITE_*_KEY env var leaked into the client build — production config must come from Vercel dashboard vars, never a local .env)',
  },
  {
    re: /assets\.aresrpg\.world/,
    why: 'the RETIRED asset CDN host is baked in — it must never be referenced again; a stale .env.production VITE_ASSETS_URL override poisoned the build',
  },
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(js|mjs|css|html|json)$/.test(name)) out.push(p)
  }
  return out
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`[assert-clean-bundle] dist not found at ${DIST} — did vite build run?`)
  process.exit(1)
}

const hits = []
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const { re, why } of FORBIDDEN) {
    const m = text.match(re)
    if (m) hits.push({ file: f.replace(DIST, 'dist'), match: m[0].slice(0, 40), why })
  }
}

// REQUIRED-CONTENT gate (issue #94). The seed manifest is a deployment pin the Vite build inlines
// (src/content/seed_manifest.ts globs packages/move/scripts/out/seed_manifest.json). The resolver now
// DEGRADES to an empty manifest when the artifact is absent instead of crashing the boot — so a
// manifest-less build no longer fails on its own. This is the CI backstop: assert the manifest actually
// RESOLVED into the shipped bundle (resolved-value, per this file's law), so a degraded/empty deploy
// fails here rather than shipping a client with no content. Returns '' when OK, else the failure reason.
function seed_manifest_problem(dist_files) {
  const rel = 'packages/move/scripts/out/seed_manifest.json'
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'move', 'scripts', 'out', 'seed_manifest.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(src, 'utf8'))
  } catch {
    return `deployment-pin manifest missing/unreadable (${rel}) — the build inlines it; without it the client boots with EMPTY content (encyclopedia, shop fence, spell rows). Commit the manifest, then rebuild.`
  }
  const ids = [...Object.values(manifest.items ?? {}), ...(manifest.worlds ?? []).map((world) => world?.id)].filter(
    (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
  )
  if (ids.length === 0) return `the manifest at ${rel} carries no on-chain object ids (empty/degenerate).`
  const [sample_id] = ids
  if (!dist_files.some((f) => readFileSync(f, 'utf8').includes(sample_id)))
    return `the manifest did NOT resolve into the shipped bundle (sample id ${sample_id} absent from every dist file) — the build inlined an empty manifest. Ensure ${rel} ships, then rebuild.`
  return ''
}

const manifest_error = seed_manifest_problem(files)

if (hits.length || manifest_error) {
  if (hits.length) {
    console.error('\n✗ BUNDLE-CLEANLINESS GATE FAILED — the built bundle contains forbidden content:\n')
    for (const h of hits) console.error(`  ${h.file}\n    matched: ${h.match}…\n    reason:  ${h.why}\n`)
    console.error('Fix: remove the offending value from every uploaded .env* file (prod config belongs in')
    console.error('the Vercel dashboard, not a shipped .env), then rebuild.\n')
  }
  if (manifest_error) console.error(`\n✗ SEED-MANIFEST GATE FAILED — ${manifest_error}\n`)
  process.exit(1)
}

console.log(
  `✓ bundle-cleanliness gate OK (${files.length} dist files scanned — no leaked keys, no dead hosts; seed manifest resolved into the bundle)`
)
