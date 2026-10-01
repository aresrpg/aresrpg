// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin, ViteDevServer } from 'vite'

import { relay_solana_rpc } from './server/solana_rpc.ts'
import { SOLANA_RPC_PATH } from './src/funding/solana_rpc_contract.ts'

const serve_rpc = async (request: IncomingMessage, response: ServerResponse, rpc_url?: string): Promise<void> => {
  const method = request.method ?? 'GET'
  const web_request = new Request(`http://${request.headers.host ?? 'localhost'}${SOLANA_RPC_PATH}`, {
    method,
    headers: {
      origin: String(request.headers.origin ?? ''),
      'content-type': String(request.headers['content-type'] ?? ''),
    },
    // Node and DOM declare different BYOB overloads for the same Web Stream boundary.
    ...(method === 'POST' && {
      body: Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>,
      duplex: 'half',
    }),
  })
  const result = await relay_solana_rpc(web_request, rpc_url)
  response.writeHead(result.status, Object.fromEntries(result.headers))
  response.end(Buffer.from(await result.arrayBuffer()))
}

export const solana_rpc_plugin = (rpc_url?: string): Plugin => {
  const attach = (server: Readonly<Pick<ViteDevServer, 'middlewares'>>): void => {
    server.middlewares.use(SOLANA_RPC_PATH, (request, response) => {
      void serve_rpc(request, response, rpc_url).catch(() => {
        response.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: 'Solana RPC request failed.' }))
      })
    })
  }
  return { name: 'aresrpg-solana-funding-rpc', configureServer: attach, configurePreviewServer: attach }
}
