// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { RedisClient } from 'bun'

import type { create_actor_runtime } from './actor_runtime.ts'
import { create_observation_router } from './observation_router.ts'
import type { BotConfig } from './model.ts'
import type { ControlStore } from './store.ts'

/** Subscription acknowledgment precedes every wallet claim. Lost read routing ends this process's actor lifetime. */
export const start_service_runtime = async (
  options: Readonly<{
    runtime: ReturnType<typeof create_actor_runtime>
    store: ControlStore
    config: BotConfig
    actor_id: string
    publisher: Pick<RedisClient, 'publish'>
    subscriber: Pick<RedisClient, 'connect' | 'close' | 'subscribe' | 'unsubscribe' | 'onclose'>
    lease_ms: number
    tick_ms: number
    heartbeat_ms: number
    report_failure: (error: unknown) => void
  }>
) => {
  const { runtime, subscriber } = options
  let router: Awaited<ReturnType<typeof create_observation_router>> | undefined
  let tick_timer: ReturnType<typeof setInterval> | undefined
  let lease_timer: ReturnType<typeof setInterval> | undefined
  let stopping: Promise<void> | undefined
  let stopped = false
  const stop = () => {
    if (stopping) return stopping
    stopped = true
    clearInterval(tick_timer)
    clearInterval(lease_timer)
    stopping = (async () => {
      try {
        const results = await Promise.allSettled([router?.stop(), runtime.stop()])
        const failure = results.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      } finally {
        subscriber.close()
      }
    })()
    return stopping
  }
  subscriber.onclose = (error) => {
    if (stopped) return
    router?.fail()
    options.report_failure(error)
    void stop().catch(options.report_failure)
  }
  try {
    await subscriber.connect()
    router = await create_observation_router({
      ...options,
      local: runtime.observe,
      timeout_ms: options.lease_ms,
    })
    if (stopped) {
      await router.stop()
      throw new Error('observation_unavailable')
    }
    await runtime.tick()
    if (stopped) throw new Error('observation_unavailable')
    tick_timer = setInterval(() => {
      void runtime.tick().catch(options.report_failure)
    }, options.tick_ms)
    lease_timer = setInterval(() => {
      void runtime.renew().catch(options.report_failure)
    }, options.heartbeat_ms)
    return { observe: router.observe, ready: () => !stopped && router!.ready(), stop }
  } catch (error) {
    await stop()
    throw error
  }
}

/** The process entry and process fixtures share this exact shutdown boundary. */
export const shutdown_service = async ({
  server,
  stop,
  redis,
  report_failure,
}: Readonly<{
  server: { stop: () => Promise<unknown> }
  stop: () => Promise<void>
  redis: { close: () => void }
  report_failure: (error: unknown) => void
}>) => {
  const results = await Promise.allSettled([server.stop(), stop()])
  redis.close()
  for (const result of results) if (result.status === 'rejected') report_failure(result.reason)
}
