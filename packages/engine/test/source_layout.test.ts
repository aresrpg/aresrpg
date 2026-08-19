// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const source_root = join(import.meta.dir, '../src')

const source_entries = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? [path, ...source_entries(path)] : [path]
  })

/// The engine's architectural boundaries: paths that must not exist, and one
/// identifier class the runtime must never know. Everything else about the
/// source text is lint's business, not the suite's.
const BANNED_PATHS = [
  { why: 'vanilla JavaScript', root: 'src', pattern: /\.(?:js|jsx)$/ },
  { why: 'a legacy folder', root: 'src', pattern: /(?:^|\/)legacy(?:\/|$)/ },
  { why: 'an extracted terrain atlas', root: 'src', pattern: /(?:terrain_(?:materials|atlas)|voxel_textures)\.ts$/ },
  { why: 'a monolithic atmosphere module', root: 'src', pattern: /\/atmosphere\.ts$/ },
  { why: 'baked foliage resources', root: 'src', pattern: /foliage_resources\.ts$/ },
  { why: 'a legacy atlas extractor', root: 'package', pattern: /(?:block_atlas|extract_legacy_atlas)/ },
] as const

describe('engine source layout', () => {
  test('the engine ships none of its banned paths and no authored material name reaches the runtime', () => {
    const roots = {
      src: source_entries(source_root),
      package: source_entries(join(source_root, '..')),
    } as const

    BANNED_PATHS.forEach(({ why, root, pattern }) => {
      expect(
        roots[root].filter((path) => pattern.test(path)),
        why
      ).toEqual([])
    })

    // Rendering recognizes engine presets; authored material names are recipe
    // data and must never be branched on in engine code.
    const runtime = roots.src
      .filter((path) => path.endsWith('.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(runtime).not.toMatch(/\b(?:meadow|foundation|basalt|loam)\b/i)
  })
})
