// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stable public files consumed by Sui Display. Authored art stays in seed/; Vite only derives
// the unfingerprinted URL contract that wallets and explorers read outside the application.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { class_names } from '@aresrpg/immutable'
import type { Plugin } from 'vite'

import { character_model_basenames } from './src/content/character_model_catalog.ts'

export type DisplayAssetRow = Readonly<{
  content_type: 'image/jpeg' | 'image/png'
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
        const source_name = `${character_model_basenames(classe, male).body}.jpg`
        return Object.freeze({
          content_type: 'image/jpeg' as const,
          output_name: `classe/${classe}_${sex}.jpg`,
          route: `/classe/${classe}_${sex}.jpg`,
          source_path: join(characters_dir, source_name),
        })
      })
    )
  )

export const display_asset_rows = async ({
  characters_dir,
  items_dir,
}: Readonly<{ characters_dir: string; items_dir: string }>): Promise<readonly DisplayAssetRow[]> =>
  Object.freeze([...(await item_asset_rows(items_dir)), ...character_asset_rows(characters_dir)])

export const display_asset_for_route = async (
  directories: Readonly<{ characters_dir: string; items_dir: string }>,
  route: string
): Promise<DisplayAssetRow | null> => (await display_asset_rows(directories)).find((row) => row.route === route) ?? null

export const display_assets_plugin = (
  directories: Readonly<{ characters_dir: string; items_dir: string }>
): readonly Plugin[] => {
  const build_plugin: Plugin = {
    name: 'aresrpg-display-assets-build',
    apply: 'build',
    async buildStart() {
      for (const row of await display_asset_rows(directories))
        // eslint-disable-next-line functional/no-this-expressions -- Vite binds its required plugin context to this hook.
        this.emitFile({ type: 'asset', fileName: row.output_name, source: await readFile(row.source_path) })
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
            const source = await readFile(row.source_path)
            response.writeHead(200, {
              'cache-control': 'public, max-age=3600',
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
