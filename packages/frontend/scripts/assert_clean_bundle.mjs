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
const VERCEL_CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json')

// Each rule: a forbidden pattern that must NEVER appear in a shipped bundle, + why.
const FORBIDDEN = [
  {
    re: /suiprivkey1[a-z0-9]{20,}/,
    why: 'a Sui private key was inlined into the bundle (a VITE_*_KEY env var leaked into the client build — production config must come from Vercel dashboard vars, never a local .env)',
  },
  {
    re: /localhost:3000/,
    why: 'the local-dev read-API host is baked into a BUILT bundle — env.ts derive_rpc_url() must resolve to the live testnet read-API on any non-dev build; a preview/production deploy that ships this spams ERR_CONNECTION_REFUSED in the console (2026-07-21)',
  },
  {
    re: /__ARES_DEV_[A-Z_]+/,
    why: 'a QA DRIVE SEAM reached the shipped bundle (issue #1025). The __ARES_DEV_* window hooks let a headless driver commit turns, land casts and name board cells; they are DEV-only by adjudication (#1006) and every registration path is gated on import.meta.env.DEV behind a dynamic import so the tree drops. A hit here means a gate was removed or a seam module was statically imported from a production path — restore the gate, never allowlist the name',
  },
  {
    re: /w[a]lrus/i,
    why: 'the retired asset-system codename reached the shipped bundle — all asset resolution and configuration must use the neutral asset vocabulary',
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

function vercel_config_problem() {
  try {
    const vercel_config = JSON.parse(readFileSync(VERCEL_CONFIG, 'utf8'))
    if (
      !Array.isArray(vercel_config?.rewrites) ||
      !vercel_config.rewrites.some((rewrite) => rewrite?.destination === '/index.html')
    )
      return 'vercel.json has no rewrite with destination "/index.html"'
  } catch {
    return 'vercel.json is missing, unreadable, or invalid JSON'
  }
  return ''
}

const vercel_config_error = vercel_config_problem()
if (vercel_config_error) {
  console.error(`[assert-clean-bundle] ${vercel_config_error}`)
  process.exit(1)
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
  const [sample_key] = Object.keys(manifest.items ?? {})
  if (!sample_key) return `the manifest at ${rel} carries no stable item keys (empty/degenerate).`
  if (!dist_files.some((f) => readFileSync(f, 'utf8').includes(sample_key)))
    return `the manifest did NOT resolve into the shipped bundle (stable item key ${sample_key} absent from every dist file) — the build inlined an empty manifest. Ensure ${rel} ships, then rebuild.`
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
  `✓ bundle-cleanliness gate OK (${files.length} dist files scanned — no leaked keys, no dead hosts, no retired asset codenames; seed manifest resolved into the bundle; SPA rewrite configured)`
)
