// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STATIC ASSET REFERENCE SWEEP (#157) — the regression tooth for "the repo split carried code but
// dropped binary chrome assets" (public/sfx/*, public/sprites/*). Walks every packages/frontend/src
// and packages/engine/src source file for string literals that reference /sfx/... or /sprites/...
// and asserts each one resolves under packages/frontend/public/ — so a future split/rename/prune
// that drops a still-referenced asset fails CI instead of shipping a 404.
//
// Comments are stripped first: this codebase wraps illustrative paths in backtick prose inside //
// comments (e.g. sfx.js's own doc comments spell out `/sfx/...`), which a naive scan would misread
// as a template literal. The match is also restricted to a path-safe character class, so a
// `${var}`-interpolated template literal (the actual dynamic path builders — sfx.js
// element_sfx_src/element_sfx_variant_src, mobs.js mob_visual_url/mob_icon_url) never matches: it
// builds its filename at runtime and can't be statically resolved here. Those generators carry
// their own coverage in sfx.js's colocated test and were hand-verified against the #157 restore
// (every (element, layer) × variant-count combination in ELEMENT_SFX_COVERAGE / SFX_VARIANTS maps
// to a real file under public/sfx/).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'bun:test'

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname)
const FRONTEND_SRC = THIS_DIR
const ENGINE_SRC = path.resolve(THIS_DIR, '../../engine/src')
const PUBLIC_DIR = path.resolve(THIS_DIR, '../public')

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs'])

/** Recursively lists every source file under `dir` matching SOURCE_EXTENSIONS. */
function walk_source_files(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) out.push(...walk_source_files(full))
    else if (SOURCE_EXTENSIONS.has(path.extname(name))) out.push(full)
  }
  return out
}

// A path-safe run: letters, digits, `_-./` — exactly what every real /sfx/ and /sprites/ filename
// in this repo is built from. A `${...}` interpolation or comment prose (a bare `...` ellipsis,
// `{layer}` placeholder notation) breaks the run, so dynamic/illustrative mentions never
// masquerade as a resolvable reference.
const PATH_RUN = '[a-zA-Z0-9_\\-./]+'
const QUOTE_PATTERNS = [
  new RegExp(`'(/(?:sfx|sprites)/${PATH_RUN})'`, 'g'),
  new RegExp(`"(/(?:sfx|sprites)/${PATH_RUN})"`, 'g'),
  new RegExp(`\`(/(?:sfx|sprites)/${PATH_RUN})\``, 'g'),
]

/** Every statically-resolvable /sfx/ or /sprites/ literal in one file, comments stripped first
 *  (both block and line comments — JSDoc routinely wraps illustrative paths in backticks, e.g.
 *  sfx.js's own `/sfx/...` doc comment, which would otherwise misread as a real reference). */
function extract_asset_refs(file) {
  const no_block_comments = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const code_only = no_block_comments
    .split('\n')
    .map((line) => line.split('//')[0])
    .join('\n')
  const refs = new Set()
  for (const pattern of QUOTE_PATTERNS) for (const match of code_only.matchAll(pattern)) refs.add(match[1])
  return refs
}

// Walrus-first, local-bundle-OPTIONAL: sky_dragon.js (flag-gated trailer decoration, ?dragon=1)
// resolves these via walrus_asset_url() first and only touches the local /sprites path if that CDN
// lookup fails. Confirmed via testnet git history (`git ls-tree -r testnet --
// packages/frontend/public/sprites/mobs/models/`) these 3 were NEVER bundled in this repo on any
// branch — a pre-existing Walrus-only gap, not a #157 split regression. Filed as a maintenance-pass
// finding, not fixed here (fabricating placeholder binaries is worse than an honest, CDN-backed gap).
const WALRUS_FIRST_ALLOWLIST = new Set([
  '/sprites/mobs/models/dragon-void.glb',
  '/sprites/mobs/models/dragon-frost.glb',
  '/sprites/mobs/models/dragon-fire.glb',
])

const SOURCE_FILES = [...walk_source_files(FRONTEND_SRC), ...walk_source_files(ENGINE_SRC)]

describe('static asset references resolve on disk (#157 regression tooth)', () => {
  it('scans a non-trivial number of source files (the sweep is actually running)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100)
  })

  it('every /sfx/ or /sprites/ literal referenced from src resolves under public/', () => {
    const missing = []
    for (const file of SOURCE_FILES)
      for (const ref of extract_asset_refs(file))
        if (!WALRUS_FIRST_ALLOWLIST.has(ref) && !existsSync(path.join(PUBLIC_DIR, ref)))
          missing.push(`${ref} — referenced by ${path.relative(FRONTEND_SRC, file)}`)
    expect(missing).toEqual([])
  })
})
