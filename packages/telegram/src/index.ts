// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_bot_client } from '@aresrpg/protocol/hosted-bot-client'

import { configuration, connected_configuration } from './config.ts'
import { create_connected } from './connected.ts'
import { load_copies } from './copy.ts'
import { create_links } from './link.ts'
import { secure_records } from './secure_records.ts'
import { open_redis } from './store.ts'
import { create_telegram } from './transport.ts'

const main = async () => {
  const config = configuration(process.env)
  const connected = connected_configuration(process.env)
  const copy = await load_copies()
  const redis = await open_redis(config.redis_url)
  const hosted = create_bot_client({
    issuer: connected.issuer,
    fetch,
    now: Date.now,
    timeout_ms: connected.limits.request_ms,
  })
  const links = create_links(
    secure_records(redis.backend, connected.storage_key),
    hosted,
    connected.callback_url,
    connected.limits.link_ttl_ms
  )
  await links.retire_ended_attempts()
  const telegram = create_telegram(connected.token, connected.limits.request_ms)
  const runtime = create_connected({
    access: redis.access,
    links,
    copy,
    secret: config.secret,
    max_request_bytes: config.maximum,
    review_ttl_ms: connected.limits.proposal_ttl_ms,
    telegram,
    bot_username: await telegram.username(),
  })
  // Public TLS termination and webhook registration are explicit operations outside this entry.
  const server = Bun.serve({ hostname: config.hostname, port: config.port, fetch: runtime.fetch })
  console.info(`Telegram listener: http://${config.hostname}:${server.port}/telegram`)
  // A listener that lost its storage for good only answers failures: it ends, and its supervisor starts a fresh one.
  const storage_lost = await new Promise<boolean>((resolve) => {
    process.once('SIGINT', () => resolve(false))
    process.once('SIGTERM', () => resolve(false))
    void redis.lost.then(() => resolve(true))
  })
  await server.stop(true)
  await runtime.drain()
  redis.close()
  if (storage_lost) {
    console.error('Telegram storage connection lost; the listener stopped and needs a restart')
    process.exitCode = 1
  }
}
await main()
