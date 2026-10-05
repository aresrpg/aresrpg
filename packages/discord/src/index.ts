// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import Redis from 'ioredis'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import logger from '@aresrpg/server/logger'
import { create_suins_resolver } from '@aresrpg/server/suins'

import { load_copy } from './copy.ts'
import { configuration } from './config.ts'
import { create_discord_api } from './api.ts'
import { create_renderer } from './render.ts'
import { create_forwarder } from './forward.ts'

const main = async () => {
  const config = configuration(process.env)
  const log = logger(import.meta)
  const api = create_discord_api(config.token, config.channel)
  const bot = await api.identity()
  const forward = create_forwarder({
    copy: await load_copy(process.env.DISCORD_LOCALE ?? 'en'),
    scope: `${config.scope}:${bot.id}`,
    network: config.network,
    resolve_name: create_suins_resolver({
      client: new SuiGrpcClient({ network: config.network, baseUrl: config.rpc_url }),
    }),
    render: await create_renderer((message) => log.warn(message)),
    send: api.send,
  })
  const subscriber = new Redis(config.redis_url, { lazyConnect: true })
  subscriber.on('error', () => log.error('Discord Redis subscription failed'))
  // Serialize only messages received by this process. Nothing is persisted or replayed.
  let pending = Promise.resolve()
  subscriber.on('message', (_channel, raw: string) => {
    pending = pending
      .then(async () => {
        const message_id = await forward(raw)
        if (message_id) log.info({ message_id }, 'Notification posted')
      })
      // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Pino reports failed live forwards; there is deliberately no replay or recovery queue.
      .catch((error: unknown) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'Notification forwarding failed')
      })
  })
  await subscriber.connect()
  const channel = `evt:notifications:${config.lineage}`
  await subscriber.subscribe(channel)
  log.info({ channel }, 'Discord subscribed to live notifications')
  const server = Bun.serve({
    port: 9801,
    fetch: (request) => {
      const path = new URL(request.url).pathname
      if (path === '/live') return new Response('ok')
      if (path === '/health') return new Response('discord', { status: subscriber.status === 'ready' ? 200 : 503 })
      return new Response('not found', { status: 404 })
    },
  })
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve)
    process.once('SIGINT', resolve)
  })
  subscriber.disconnect()
  await pending
  await server.stop()
}
await main()
