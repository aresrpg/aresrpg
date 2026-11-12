// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { RedisClient } from 'bun'
import { SuiGrpcClient } from '@mysten/sui/grpc'

import { create_reporting } from './reporting.ts'
import { read_config, deployment_integer, deployment_value } from './config.ts'
import { create_redis_store, type ControlStore } from './store.ts'
import { create_owner_verifier } from './owner_proof.ts'
import { create_ingress } from './http.ts'
import { create_envelope_cipher } from './envelope_cipher.ts'
import type { Observe } from './control.ts'
import type { BotConfig } from './model.ts'
import { shutdown_service, start_service_runtime } from './service_runtime.ts'

type RuntimeOptions = Readonly<{
  env: Readonly<Record<string, string | undefined>>
  config: BotConfig
  store: ControlStore
  rpc_url: string
  redis: RedisClient
  report_failure: (error: unknown) => void
}>
const start_http = ({ env, config, store, rpc_url }: RuntimeOptions, observe: Observe, ready: () => boolean) => {
  const client = new SuiGrpcClient({ network: config.network, baseUrl: rpc_url })
  const fetch = create_ingress({
    store,
    config,
    observe,
    ready,
    verify_owner: create_owner_verifier(client),
    policy: { revision: 1, scopes: config.scopes },
    observation_freshness_ms: config.observation_freshness_ms,
    provision_enabled: env.BOT_PROVISION_ENABLED === 'true',
    play_enabled: env.BOT_PLAY_ENABLED === 'true',
  })
  return Bun.serve({ port: deployment_integer(env, 'BOT_PORT'), hostname: '0.0.0.0', fetch })
}
const start_actor = async ({ env, config, store, rpc_url, redis, report_failure }: RuntimeOptions) => {
  const { create_key_provider, parse_signing_keyring } = await import('./managed_signer.ts')
  const { create_actor_runtime } = await import('./actor_runtime.ts')
  const provider = create_key_provider(
    store,
    parse_signing_keyring(await readFile(deployment_value(env, 'BOT_SIGNING_KEYRING_FILE'), 'utf8'))
  )
  const cipher = create_envelope_cipher(
    await readFile(deployment_value(env, 'BOT_ENVELOPE_KEY_FILE')),
    await readFile(deployment_value(env, 'BOT_ENVELOPE_KEY_ID_FILE'), 'utf8')
  )
  const lease_ms = deployment_integer(env, 'BOT_LEASE_MS')
  const tick_ms = deployment_integer(env, 'BOT_TICK_MS')
  const heartbeat_ms = deployment_integer(env, 'BOT_HEARTBEAT_MS')
  if (heartbeat_ms >= lease_ms) throw new Error('Heartbeat cadence must be shorter than lease')
  const actor_id = randomUUID()
  const runtime = create_actor_runtime({
    store,
    config,
    provider,
    cipher,
    endpoint: deployment_value(env, 'BOT_GAME_ENDPOINT'),
    origin: config.web_origin,
    actor_id,
    sdk_options: { rpc_url },
    lease_ms,
    event_limit: deployment_integer(env, 'BOT_EVENT_LIMIT'),
    scan_limit: deployment_integer(env, 'BOT_SCAN_LIMIT'),
    observation_freshness_ms: config.observation_freshness_ms,
    report_failure,
  })
  return start_service_runtime({
    runtime,
    store,
    config,
    actor_id,
    publisher: redis,
    subscriber: new RedisClient(deployment_value(env, 'BOT_REDIS_URL'), {
      autoReconnect: false,
      enableOfflineQueue: false,
    }),
    lease_ms,
    tick_ms,
    heartbeat_ms,
    report_failure,
  })
}

/** The entire service is trusted wallet authority; Redis is private durable control storage. */
const main = async () => {
  const { env } = process
  const reporting = create_reporting(env)
  const { report_failure } = reporting
  let redis: RedisClient | null = null
  let stop_actor: (() => Promise<void>) | null = null
  try {
    redis = new RedisClient(deployment_value(env, 'BOT_REDIS_URL'), {
      autoReconnect: false,
      enableOfflineQueue: false,
    })
    await redis.connect()
    const config = read_config(env)
    const rpc_url = deployment_value(env, 'BOT_SUI_RPC_URL')
    if (new URL(rpc_url).protocol !== 'https:') throw new Error('Sui RPC requires HTTPS')
    const options = { env, config, store: create_redis_store(redis), rpc_url, redis, report_failure }
    const { stop, observe, ready } = await start_actor(options)
    stop_actor = stop
    const server = start_http(options, observe, ready)
    const shutdown = () => {
      void shutdown_service({
        server,
        stop,
        redis: options.redis,
        report_failure,
        flush_reporting: reporting.flush,
      }).catch(report_failure)
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  } catch (error) {
    report_failure(error)
    await stop_actor?.().catch(report_failure)
    redis?.close()
    await reporting.flush().catch(report_failure)
    process.exitCode = 1
  }
}
if (import.meta.main) await main()
