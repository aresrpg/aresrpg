// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STATIC ASSET REFERENCE SWEEP (#157) — the regression tooth for "the repo split carried code but
// dropped binary chrome assets" (public/sfx/*, public/sprites/*). Walks every shipped packages/frontend/src
// and packages/engine/src source file for string literals that reference /sfx/... or /sprites/...
// and asserts each one resolves under packages/frontend/public/ — so a future split/rename/prune
// that drops a still-referenced asset fails CI instead of shipping a 404.
//
// Comments are stripped first: this codebase wraps illustrative paths in backtick prose inside //
// comments (e.g. audio_registry.js's own doc comments can spell out illustrative paths), which a naive scan would misread
// as a template literal. The match is also restricted to a path-safe character class, so a
// `${var}`-interpolated template literal (the actual dynamic path builders — audio_registry.js's elemental
// variants, mobs.js mob_visual_url/mob_icon_url) never matches: it builds its filename at runtime and can't be
// statically resolved here. The audio registry's colocated test compares its complete SFX map to public/sfx/.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'bun:test'

import { production_source_paths } from './test_helpers/production_source_paths.js'

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname)
const FRONTEND_SRC = THIS_DIR
const ENGINE_SRC = path.resolve(THIS_DIR, '../../engine/src')
const PUBLIC_DIR = path.resolve(THIS_DIR, '../public')

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
function extract_asset_refs(contents) {
  const no_block_comments = contents.replace(/\/\*[\s\S]*?\*\//g, '')
  const code_only = no_block_comments
    .split('\n')
    .map((line) => line.split('//')[0])
    .join('\n')
  const refs = new Set()
  for (const pattern of QUOTE_PATTERNS) for (const match of code_only.matchAll(pattern)) refs.add(match[1])
  return refs
}

// Asset references in colocated tests cannot ship. Keeping those out bounds the sweep from 1,473 files to the
// two production source surfaces while retaining the cross-package assertion that protects runtime assets.
const SOURCE_FILES = [...production_source_paths(FRONTEND_SRC), ...production_source_paths(ENGINE_SRC)]
const read_sources = () => Promise.all(SOURCE_FILES.map(async (file) => [file, await Bun.file(file).text()]))

describe('static asset references resolve on disk (#157 regression tooth)', () => {
  it('scans a non-trivial number of source files (the sweep is actually running)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100)
  })

  it('every /sfx/ or /sprites/ literal referenced from src resolves under public/', async () => {
    const missing = []
    for (const [file, contents] of await read_sources())
      for (const ref of extract_asset_refs(contents))
        if (!existsSync(path.join(PUBLIC_DIR, ref)))
          missing.push(`${ref} — referenced by ${path.relative(FRONTEND_SRC, file)}`)
    expect(missing).toEqual([])
  })
})

// #353 — the local mob-icon sprite set predates the asset-host `mobs/` family going live and was pure
// migration residue: gitignored, never tracked by git, never shipped past a dev's own disk. Deleted;
// get_mob_icon_url (mobs.js) is asset-host-only now. This gate is the tripwire against reintroduction —
// of the directory (force-added back) or of code resolving it again (a template-literal path build,
// which extract_asset_refs' static-quote regex above can't see since it's interpolated, not a plain
// literal — exactly how the deleted fallback slipped past that sweep originally).
describe('mob-icon local sprite directory stays deleted (#353 regression tooth)', () => {
  // Built via join, not a literal, so this file's own needle never trips the sweep it defines.
  const BANNED_LOCAL_MOB_ICON_PATH = ['sprites', 'mobs', 'icons'].join('/')

  it('the local mob-icon directory does not exist under public/', () => {
    expect(existsSync(path.join(PUBLIC_DIR, BANNED_LOCAL_MOB_ICON_PATH))).toBe(false)
  })

  it('no source file references the local mob-icon path, in any literal or interpolated form', async () => {
    const hits = (await read_sources())
      .filter(([, contents]) => contents.includes(BANNED_LOCAL_MOB_ICON_PATH))
      .map(([file]) => path.relative(FRONTEND_SRC, file))
    expect(hits).toEqual([])
  })
})
