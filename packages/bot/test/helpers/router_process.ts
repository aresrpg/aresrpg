// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Two OS processes use real Redis. Game WebSocket and Sui remain explicit local fixture transports.
import { create_actor_runtime } from '../../src/actor_runtime.ts'
import { shutdown_service, start_service_runtime } from '../../src/service_runtime.ts'
import { create_redis_store } from '../../src/store.ts'
import { create_ingress } from '../../src/http.ts'
import { fake_client, pins } from '../../../sdk/test/helpers/transport.ts'

import { runtime_fixture } from './runtime_fixture.ts'
import { fixture_redis } from './redis_fixture.ts'

const main = async () => {
  const [url, namespace, actor_id] = process.argv.slice(2) as [string, string, string]
  const redis = fixture_redis(url)
  const subscriber = fixture_redis(url)
  let stop_service: (() => Promise<void>) | undefined
  try {
    await redis.connect()
    await subscriber.connect()
    const subscriber_id = await subscriber.send('CLIENT', ['ID'])
    const f = await runtime_fixture()
    await f.runtime.stop()
    const store = create_redis_store(redis, namespace)
    const failures: string[] = []
    const runtime = create_actor_runtime({
      ...f.options,
      store,
      actor_id,
      now: Date.now,
      lease_ms: 600,
      sdk_options: { client: fake_client({ simulate_ok: true }) as never, pins },
      report_failure: (error) => {
        failures[failures.length] = String(error)
      },
    })
    let tick_enabled = true
    let read_mode = 'normal'
    let publish_mode = 'normal'
    const held = new Set<() => void>()
    const release = () => {
      for (const resolve of held) resolve()
      held.clear()
    }
    let read_entered = false
    const hold = async () => {
      read_entered = true
      await new Promise<void>((resolve) => {
        held.add(resolve)
      })
    }
    let unsubscribe_failure = false
    let stop_held = false
    let stop_entered = false
    let runtime_drained = false
    let local_reads = 0
    const unsubscribe = subscriber.unsubscribe.bind(subscriber)
    subscriber.unsubscribe = async () => {
      if (unsubscribe_failure) throw new Error('fixture_unsubscribe_failure')
      return unsubscribe()
    }
    const service = await start_service_runtime({
      runtime: {
        ...runtime,
        tick: async () => {
          if (tick_enabled) await runtime.tick()
        },
        stop: async () => {
          stop_entered = true
          if (stop_held)
            await new Promise<void>((resolve) => {
              held.add(resolve)
            })
          await runtime.stop()
          runtime_drained = true
        },
        observe: async (...args) => {
          local_reads += 1
          if (read_mode === 'error') throw new Error('invalid_gameplay_payload')
          if (read_mode === 'hold') await hold()
          const value = await runtime.observe(...args)
          if (read_mode === 'hold_result') await hold()
          return value
        },
      },
      store,
      config: f.options.config,
      actor_id,
      subscriber,
      publisher: {
        publish: async (channel, message) => {
          if (publish_mode === 'stall') return new Promise<number>(() => undefined)
          if (publish_mode === 'reject') throw new Error('fixture_publish_failure')
          return redis.publish(channel, message)
        },
      },
      lease_ms: 600,
      tick_ms: 50,
      heartbeat_ms: 80,
      report_failure: (error) => {
        failures[failures.length] = String(error)
      },
    })
    stop_service = service.stop
    const ingress = create_ingress({
      store,
      config: f.options.config,
      observe: service.observe,
      ready: service.ready,
      verify_owner: async () => {
        throw new Error('no_owner_verification_in_fixture')
      },
      policy: f.bot.policy,
      observation_freshness_ms: 60000,
      provision_enabled: false,
      play_enabled: false,
    })
    const commands: Record<string, (payload: Record<string, unknown>) => Promise<unknown>> = {
      observe: (payload) => service.observe(f.grant, payload),
      planning: (payload) => service.observe(f.grant, payload),
      admit: async () => {
        await f.admit()
        await runtime.settle()
        return true
      },
      pause_work: async () => {
        tick_enabled = false
        return true
      },
      tick: async () => {
        await runtime.tick()
        await runtime.settle()
        return true
      },
      mode: async (payload) => {
        read_entered = false
        read_mode = String(payload.read ?? 'normal')
        publish_mode = String(payload.publish ?? 'normal')
        return true
      },
      shutdown_fault: async (payload) => {
        unsubscribe_failure = payload.unsubscribe === true
        stop_held = payload.hold === true
        return true
      },
      release: async () => {
        release()
        return true
      },
      takeover: async () => {
        f.sockets.at(-1)!.handlers.on_close(4000, 'REPLACED')
        await runtime.settle()
        return true
      },
      status: async () => ({
        pid: process.pid,
        actor_id,
        subscriber_id,
        ready: service.ready(),
        read_entered,
        local_reads,
        stop_entered,
        runtime_drained,
        sockets: f.sockets.length,
        closed: f.sockets.every(({ closed }) => closed),
        failures,
        health: (await ingress(new Request(`${f.options.config.issuer}/health`))).status,
      }),
      stop: async () => {
        await service.stop()
        return true
      },
    }
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: ingress })
    const shutdown = () => {
      void shutdown_service({
        server,
        stop: service.stop,
        redis,
        report_failure: (error) => {
          failures[failures.length] = String(error)
        },
      }).then(() => {
        process.send?.({
          id: -1,
          ok: true,
          value: {
            runtime_drained,
            failures,
            closed: f.sockets.every(({ closed }) => closed),
            subscriber_connected: subscriber.connected,
            redis_connected: redis.connected,
          },
        })
        process.disconnect?.()
      })
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
    process.on('message', (message: { id: number; command: string; payload: Record<string, unknown> }) => {
      void (async () => {
        try {
          const value = await commands[message.command]!(message.payload)
          process.send?.({ id: message.id, ok: true, value })
        } catch (error) {
          process.send?.({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      })()
    })
    process.send?.({ id: 0, ok: true, value: { pid: process.pid, actor_id, subscriber_id } })
  } catch (error) {
    try {
      await stop_service?.()
    } finally {
      subscriber.close()
      redis.close()
      process.disconnect?.()
    }
    throw error
  }
}
if (import.meta.main) await main()
