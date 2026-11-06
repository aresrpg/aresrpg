// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Plugin, ViteDevServer } from 'vite'

import { PORTRAIT_PATH } from '../immutable/src/portrait.ts'

import { serve_portrait } from './server/portrait.ts'
export const portrait_dev_plugin = (): Plugin => {
  const attach = (server: Readonly<Pick<ViteDevServer, 'middlewares'>>): void => {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== PORTRAIT_PATH) return next()
      const run = async (): Promise<void> => {
        const result = await serve_portrait(
          new Request(`http://localhost${request.url}`, {
            method: request.method,
            headers: request.headers as Record<string, string>,
          })
        )
        response.writeHead(result.status, Object.fromEntries(result.headers))
        response.end(Buffer.from(await result.arrayBuffer()))
      }
      void run().catch((error: unknown) => {
        console.error('Local portrait service failed', error)
        response.writeHead(503, { 'cache-control': 'no-store' })
        response.end()
      })
    })
  }
  return { name: 'aresrpg-portraits', configureServer: attach, configurePreviewServer: attach }
}
