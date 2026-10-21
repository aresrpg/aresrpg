// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync } from 'node:fs'

import type { Plugin } from 'vite'

export const public_pages_plugin = (): Plugin => ({
  name: 'aresrpg-public-pages',
  configureServer: (server) => {
    if (!server.config.publicDir) return
    const pages = new Map(
      readdirSync(server.config.publicDir, { recursive: true })
        .map(String)
        .filter((path) => path.endsWith('/index.html'))
        .map((path) => [`/${path.slice(0, -'/index.html'.length)}`, `/${path}`])
    )
    server.middlewares.use((request, _response, next) => {
      const [path, query] = (request.url ?? '').split(/\?(.*)/s)
      const page = pages.get(path!.replace(/\/$/, ''))
      // Vite's public-file middleware matches files, not directory indexes.
      // eslint-disable-next-line no-param-reassign -- Connect middleware rewrites the request before Vite serves it.
      if (page) request.url = page + (query === undefined ? '' : `?${query}`)
      next()
    })
  },
})
