// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Build derivation for the authored seed/sounds corpus. Runtime keeps the legacy
// /sound_effect/<file> contract without a second checked-in asset home.

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Plugin } from 'vite'

const SOUND_ROUTE = '/sound_effect/'

export const sound_assets_plugin = (sounds_dir: string): Plugin => {
  let filenames: readonly string[] = Object.freeze([])
  const load_filenames = async (): Promise<readonly string[]> => {
    if (filenames.length > 0) return filenames
    filenames = Object.freeze(
      (await readdir(sounds_dir, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map(({ name }) => name)
        .sort()
    )
    return filenames
  }
  return {
    name: 'aresrpg-sound-assets',
    async buildStart() {
      const files = await load_filenames()
      await Promise.all(
        files.map(async (file) =>
          // eslint-disable-next-line functional/no-this-expressions -- Vite binds its required plugin context to this hook.
          this.emitFile({
            type: 'asset',
            fileName: `sound_effect/${file}`,
            source: await readFile(join(sounds_dir, file)),
          })
        )
      )
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        if (!url.pathname.startsWith(SOUND_ROUTE) || request.method !== 'GET') return next()
        const requested = decodeURIComponent(url.pathname.slice(SOUND_ROUTE.length))
        if (!requested || basename(requested) !== requested) return next()
        void load_filenames().then(async (files) => {
          if (!files.includes(requested)) return next()
          const source = await readFile(join(sounds_dir, requested))
          response.writeHead(200, {
            'content-type': requested.endsWith('.aac') ? 'audio/aac' : 'audio/ogg',
            'cache-control': 'public, max-age=3600',
            'content-length': source.byteLength,
          })
          response.end(source)
        }, next)
      })
    },
  }
}
