// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Build derivation for the authored seed/sounds corpus. Runtime keeps the legacy
// /sound_effect/<file> contract without a second checked-in asset home.

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Plugin } from 'vite'

const SOUND_ROUTE = '/sound_effect/'

const audio_assets_plugin = ({
  name,
  source_dir,
  route,
  output_dir,
  accepts,
  content_type,
}: Readonly<{
  name: string
  source_dir: string
  route: string
  output_dir: string
  accepts: (file: string) => boolean
  content_type: (file: string) => string
}>): readonly Plugin[] => {
  const load_filenames = async (): Promise<readonly string[]> =>
    Object.freeze(
      (await readdir(source_dir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && accepts(entry.name))
        .map(({ name }) => name)
        .sort()
    )
  const build_plugin: Plugin = {
    name: `${name}-build`,
    apply: 'build',
    async buildStart() {
      const files = await load_filenames()
      await Promise.all(
        files.map(async (file) =>
          // eslint-disable-next-line functional/no-this-expressions -- Vite binds its required plugin context to this hook.
          this.emitFile({
            type: 'asset',
            fileName: `${output_dir}/${file}`,
            source: await readFile(join(source_dir, file)),
          })
        )
      )
    },
  }
  const serve_plugin: Plugin = {
    name: `${name}-serve`,
    apply: 'serve',
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        if (!url.pathname.startsWith(route) || request.method !== 'GET') return next()
        const requested = decodeURIComponent(url.pathname.slice(route.length))
        if (!requested || basename(requested) !== requested) return next()
        void load_filenames().then(async (files) => {
          if (!files.includes(requested)) return next()
          const source = await readFile(join(source_dir, requested))
          response.writeHead(200, {
            'content-type': content_type(requested),
            'cache-control': 'public, max-age=3600',
            'content-length': source.byteLength,
          })
          response.end(source)
        }, next)
      })
    },
  }
  return Object.freeze([build_plugin, serve_plugin])
}

export const sound_assets_plugin = (sounds_dir: string): readonly Plugin[] =>
  audio_assets_plugin({
    name: 'aresrpg-sound-assets',
    source_dir: sounds_dir,
    route: SOUND_ROUTE,
    output_dir: 'sound_effect',
    accepts: (file) => file.endsWith('.aac') || file.endsWith('.ogg'),
    content_type: (file) => (file.endsWith('.aac') ? 'audio/aac' : 'audio/ogg'),
  })

export const music_assets_plugin = (music_dir: string): readonly Plugin[] =>
  audio_assets_plugin({
    name: 'aresrpg-music-assets',
    source_dir: music_dir,
    route: '/music/',
    output_dir: 'music',
    accepts: (file) => file.endsWith('.mp3'),
    content_type: () => 'audio/mpeg',
  })
