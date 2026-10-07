// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'

import type { Plugin, ViteDevServer } from 'vite'
import type { Pins } from '@aresrpg/sdk/pins'
import { GIFT_API_PATH } from '@aresrpg/sdk/gift'

import { serve_gift } from './server/gift.ts'

export const gift_dev_plugin = (env: Readonly<Record<string, string>>): Plugin => {
  const attach = (server: Readonly<Pick<ViteDevServer, 'middlewares'>>): void => {
    server.middlewares.use(GIFT_API_PATH, (request, response) => {
      const run = async (): Promise<void> => {
        const pins_file =
          env.ARES_PINS_FILE ??
          new URL(env.VITE_NETWORK === 'testnet' ? '../../.dev/pins.json' : '../../pins.json', import.meta.url)
        const pins = JSON.parse(await readFile(pins_file, 'utf8')) as Pins
        const method = request.method ?? 'GET'
        const web_request = new Request(`http://${request.headers.host ?? 'localhost'}${GIFT_API_PATH}`, {
          method,
          headers: { origin: String(request.headers.origin ?? '') },
          ...(method === 'POST' && {
            body: Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>,
            duplex: 'half',
          }),
        })
        const result = await serve_gift(web_request, {
          pins,
          private_key: env.GIFT_SPONSOR_PRIVATE_KEY,
          rpc_url: env.VITE_SUI_RPC_URL,
          graphql_url: env.VITE_GRAPHQL_URL,
        })
        response.writeHead(result.status, Object.fromEntries(result.headers))
        response.end(Buffer.from(await result.arrayBuffer()))
      }
      void run().catch((error: unknown) => {
        console.error('Local gift service failed.', error)
        response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: 'unavailable' }))
      })
    })
  }
  return { name: 'aresrpg-gift-service', configureServer: attach, configurePreviewServer: attach }
}
