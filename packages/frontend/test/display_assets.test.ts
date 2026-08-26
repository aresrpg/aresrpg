// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { class_names } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import { display_asset_for_route, display_asset_rows } from '../display_assets.ts'

const repo_dir = resolve(import.meta.dir, '../../..')

test('every emitted Sui Display image URL resolves to one authored source asset', async () => {
  const rows = await display_asset_rows({
    characters_dir: resolve(repo_dir, 'seed/icons/characters'),
    items_dir: resolve(repo_dir, 'seed/icons/items'),
  })
  const routes = new Set(rows.map(({ route }) => route))

  expect(routes.size).toBe(rows.length)
  expect(routes.has('/item/water_hd.png')).toBeTrue()
  for (const classe of class_names)
    for (const sex of ['male', 'female']) expect(routes.has(`/classe/${classe}_${sex}.jpg`)).toBeTrue()
  expect(rows.every(({ source_path }) => existsSync(source_path))).toBeTrue()
})

test('the dev display route discovers HD item art added after server startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aresrpg-display-assets-'))
  const routes = { characters_dir: directory, items_dir: directory }
  try {
    await writeFile(join(directory, 'new_item.png'), Buffer.from([1]))
    expect((await display_asset_for_route(routes, '/item/new_item_hd.png'))?.source_path).toBe(
      join(directory, 'new_item.png')
    )

    await writeFile(join(directory, 'new_item_hd.png'), Buffer.from([2]))
    expect((await display_asset_for_route(routes, '/item/new_item_hd.png'))?.source_path).toBe(
      join(directory, 'new_item_hd.png')
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('production SPA rewrites never capture stable Sui Display assets', async () => {
  const config = JSON.parse(await Bun.file(new URL('../vercel.json', import.meta.url)).text()) as {
    rewrites: readonly Readonly<{ source: string }>[]
  }
  const source = config.rewrites[0]?.source ?? ''
  expect(source).toContain('item/')
  expect(source).toContain('classe/')
  const rewrite = new RegExp(`^${source}$`)
  expect(rewrite.test('/item/cape_fuwa__white_hd.png')).toBeFalse()
  expect(rewrite.test('/classe/yogan_male.jpg')).toBeFalse()
  expect(rewrite.test('/encyclopedia/items')).toBeTrue()
})
