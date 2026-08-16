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

describe('engine source layout', () => {
  test('active runtime code contains neither vanilla JavaScript nor a legacy folder', () => {
    const entries = source_entries(source_root)
    expect(entries.filter((path) => /\.(?:js|jsx)$/.test(path))).toEqual([])
    expect(entries.filter((path) => path.split('/').includes('legacy'))).toEqual([])
    expect(entries.filter((path) => /(?:terrain_(?:materials|atlas)|voxel_textures)\.ts$/.test(path))).toEqual([])
  })

  test('the color-only engine ships no extracted terrain atlases', () => {
    const package_entries = source_entries(join(source_root, '..'))
    expect(package_entries.filter((path) => /(?:block_atlas|extract_legacy_atlas)/.test(path))).toEqual([])
  })

  test('world-authored colors need no terrain or foliage texture resources', () => {
    const entries = source_entries(source_root)
    const terrain_pool = readFileSync(join(source_root, 'terrain_pool.ts'), 'utf8')

    expect(entries.filter((path) => /foliage_resources\.ts$/.test(path))).toEqual([])
    expect(terrain_pool).not.toContain('DataArrayTexture')
    expect(terrain_pool).not.toContain('texture(')
  })

  test('runtime rendering never recognizes authored material names', () => {
    const runtime = source_entries(source_root)
      .filter((path) => path.endsWith('.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(runtime).not.toMatch(/\b(?:grass|dirt|stone|sand)\b/i)
  })
})
