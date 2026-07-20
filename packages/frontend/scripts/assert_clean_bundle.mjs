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

if (hits.length) {
  console.error('\n✗ BUNDLE-CLEANLINESS GATE FAILED — the built bundle contains forbidden content:\n')
  for (const h of hits) console.error(`  ${h.file}\n    matched: ${h.match}…\n    reason:  ${h.why}\n`)
  console.error('Fix: remove the offending value from every uploaded .env* file (prod config belongs in')
  console.error('the Vercel dashboard, not a shipped .env), then rebuild.\n')
  process.exit(1)
}

console.log(`✓ bundle-cleanliness gate OK (${files.length} dist files scanned — no leaked keys, no dead hosts)`)
