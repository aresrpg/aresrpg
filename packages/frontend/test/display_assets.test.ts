// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { class_names } from '@aresrpg/immutable'
import { loadImage } from '@napi-rs/canvas'
import { expect, test } from 'bun:test'

import { display_asset_bytes, display_asset_for_route, display_asset_rows } from '../display_assets.ts'

const repo_dir = resolve(import.meta.dir, '../../..')

test('only content-addressed assets receive immutable browser caching', async () => {
  const config = (await Bun.file(new URL('../vercel.json', import.meta.url)).json()) as {
    headers: readonly { source: string; headers: readonly { key: string; value: string }[] }[]
  }
  const cache_policy = (path: string) =>
    config.headers
      .filter(({ source }) => new RegExp(`^${source.replace(':path*', '(.*)')}$`).test(path))
      .flatMap(({ headers }) => headers)
      .find(({ key }) => key.toLowerCase() === 'cache-control')?.value ?? ''
  for (const path of ['/assets/index-abcdefgh.js', '/assets/thebes-abcdefgh.json'])
    expect(cache_policy(path)).toBe('public, max-age=31536000, immutable')
  for (const path of ['/', '/index.html', '/sw.js', '/item/sword.png', '/classe/senshi.jpg', '/music/nauvis.mp3'])
    expect(cache_policy(path)).not.toMatch(/immutable|max-age=[1-9]/)
})

test('every emitted Sui Display image URL resolves to one authored source asset', async () => {
  const rows = await display_asset_rows({
    characters_dir: resolve(repo_dir, 'seed/icons/characters'),
    items_dir: resolve(repo_dir, 'seed/icons/items'),
  })
  const routes = new Set(rows.map(({ route }) => route))

  expect(routes.size).toBe(rows.length)
  for (const classe of class_names)
    for (const sex of ['male', 'female']) expect(routes.has(`/classe/${classe}_${sex}.jpg`)).toBeTrue()
  expect(rows.every(({ source_path }) => existsSync(source_path))).toBeTrue()
})

test('wallet portraits derive valid JPEGs from PNGs without stored JPEG copies', async () => {
  const characters_dir = resolve(repo_dir, 'seed/icons/characters')
  expect(readdirSync(characters_dir).filter((name) => /\.jpe?g$/iu.test(name))).toEqual([])
  const rows = await display_asset_rows({ characters_dir, items_dir: resolve(repo_dir, 'seed/icons/items') })
  const portraits = rows.filter(({ content_type }) => content_type === 'image/jpeg')
  expect(portraits).toHaveLength(24)
  for (const row of portraits) {
    expect(row.source_path.endsWith('.png')).toBeTrue()
    const bytes = await display_asset_bytes(row)
    expect([...bytes.slice(0, 3)]).toEqual([255, 216, 255])
    const image = await loadImage(Buffer.from(bytes))
    expect([image.width, image.height]).toEqual([512, 512])
  }
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
    rewrites: readonly Readonly<{ source: string; destination: string }>[]
  }
  const source = config.rewrites.find(({ destination }) => destination === '/index.html')?.source ?? ''
  expect(source).toContain('item/')
  expect(source).toContain('classe/')
  const rewrite = new RegExp(`^${source}$`)
  expect(rewrite.test('/item/cape_fuwa__white_hd.png')).toBeFalse()
  expect(rewrite.test('/classe/yogan_male.jpg')).toBeFalse()
  expect(rewrite.test('/encyclopedia/items')).toBeTrue()
})

test('production CSP permits the official zkSend hosted claim origin', async () => {
  const config = JSON.parse(await Bun.file(new URL('../vercel.json', import.meta.url)).text()) as {
    headers: readonly Readonly<{ headers: readonly Readonly<{ key: string; value: string }>[] }>[]
  }
  const policy = config.headers.flatMap(({ headers }) => headers).find(({ key }) => key === 'Content-Security-Policy')
  expect(policy?.value).toContain('https://api.slush.app')
})
