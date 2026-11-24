// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stable public files derived from seed/icons: the art Sui Display reads outside the application, and every icon
// the application shows, at `/icons/<family>/<file>`. An icon's URL is its identity, so a page loads only the icons
// it shows. Development serves the files straight from seed/ (never cached, so an edited icon shows at once);
// the build emits the same files at the same paths.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { class_names } from '@aresrpg/immutable'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { Plugin } from 'vite'

import { character_model_basenames } from './src/content/character_model_catalog.ts'

export type DisplayAssetRow = Readonly<{
  content_type: 'image/jpeg' | 'image/png' | 'image/webp'
  output_name: string
  route: string
  source_path: string
}>

const item_asset_rows = async (items_dir: string): Promise<readonly DisplayAssetRow[]> => {
  const names = new Set(
    (await readdir(items_dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
      .map(({ name }) => name)
  )
  const item_types = [...new Set([...names].map((name) => name.replace(/_hd\.png$/u, '').replace(/\.png$/u, '')))]
  return Object.freeze(
    item_types
      .map((item_type) =>
        Object.freeze({
          content_type: 'image/png' as const,
          output_name: `item/${item_type}_hd.png`,
          route: `/item/${item_type}_hd.png`,
          source_path: join(items_dir, names.has(`${item_type}_hd.png`) ? `${item_type}_hd.png` : `${item_type}.png`),
        })
      )
      .sort((left, right) => left.route.localeCompare(right.route))
  )
}

const character_asset_rows = (characters_dir: string): readonly DisplayAssetRow[] =>
  Object.freeze(
    class_names.flatMap((classe) =>
      ([true, false] as const).map((male) => {
        const sex = male ? 'male' : 'female'
        const source_name = `${character_model_basenames(classe, male).body}.png`
        return Object.freeze({
          content_type: 'image/jpeg' as const,
          output_name: `classe/${classe}_${sex}.jpg`,
          route: `/classe/${classe}_${sex}.jpg`,
          source_path: join(characters_dir, source_name),
        })
      })
    )
  )

/** The icon families the application shows, by folder of seed/icons. HD renders stay out: they are Display art. */
const ICON_FAMILIES = Object.freeze([
  { family: 'items', extension: '.png', content_type: 'image/png' },
  { family: 'mobs', extension: '.png', content_type: 'image/png' },
  { family: 'spells', extension: '.webp', content_type: 'image/webp' },
  { family: 'characters', extension: '.png', content_type: 'image/png' },
  { family: 'nameplates', extension: '.png', content_type: 'image/png' },
] as const)

const icon_rows = async (icons_dir: string): Promise<readonly DisplayAssetRow[]> =>
  (
    await Promise.all(
      ICON_FAMILIES.map(async ({ family, extension, content_type }) =>
        (await readdir(join(icons_dir, family)))
          .filter((name) => name.endsWith(extension) && !name.endsWith(`_hd${extension}`))
          .map((name) =>
            Object.freeze({
              content_type,
              output_name: `icons/${family}/${name}`,
              route: `/icons/${family}/${name}`,
              source_path: join(icons_dir, family, name),
            })
          )
      )
    )
  ).flat()

export const display_asset_rows = async ({
  icons_dir,
}: Readonly<{ icons_dir: string }>): Promise<readonly DisplayAssetRow[]> =>
  Object.freeze([
    ...(await item_asset_rows(join(icons_dir, 'items'))),
    ...character_asset_rows(join(icons_dir, 'characters')),
    ...(await icon_rows(icons_dir)),
  ])

export const display_asset_for_route = async (
  directories: Readonly<{ icons_dir: string }>,
  route: string
): Promise<DisplayAssetRow | null> => (await display_asset_rows(directories)).find((row) => row.route === route) ?? null

export const display_asset_bytes = async (row: DisplayAssetRow): Promise<Uint8Array> => {
  if (row.content_type !== 'image/jpeg') return readFile(row.source_path)
  const image = await loadImage(row.source_path)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#09090e'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
  return canvas.encode('jpeg', 92)
}

export const display_assets_plugin = (directories: Readonly<{ icons_dir: string }>): readonly Plugin[] => {
  const build_plugin: Plugin = {
    name: 'aresrpg-display-assets-build',
    apply: 'build',
    async buildStart() {
      for (const row of await display_asset_rows(directories))
        // eslint-disable-next-line functional/no-this-expressions -- Vite binds its required plugin context to this hook.
        this.emitFile({ type: 'asset', fileName: row.output_name, source: await display_asset_bytes(row) })
    },
  }
  const serve_plugin: Plugin = {
    name: 'aresrpg-display-assets-serve',
    apply: 'serve',
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET') return next()
        const path = decodeURIComponent(
          new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
        )
        void display_asset_for_route(directories, path)
          .then(async (row) => {
            if (!row) return next()
            const source = await display_asset_bytes(row)
            response.writeHead(200, {
              'cache-control': 'no-store',
              'content-length': source.byteLength,
              'content-type': row.content_type,
            })
            response.end(source)
          })
          .catch(next)
      })
    },
  }
  return Object.freeze([build_plugin, serve_plugin])
}
