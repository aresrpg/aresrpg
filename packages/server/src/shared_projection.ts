// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Public projections share reads across viewers; sampled entries also bridge idle cooldowns and pending reads.
/* eslint-disable no-param-reassign -- This subscription lifecycle owns private entries; callers never receive them. */
import type { Bus } from './pubsub_bus.ts'
import type { EventEnvelope } from './protocol.ts'
import logger from './logger.ts'

const log = logger(import.meta)
type Consumer<Value> = Readonly<{ deliver: (value: Value) => void; fail: (error: unknown) => void }>
type Entry<Value> = {
  consumers: Set<Consumer<Value>>
  value: Value | undefined
  revision: number
  current: number
  last_started: number
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  subscribed: boolean
  closed: boolean
  ready: Promise<void>
  resume: () => void
  pause: () => void
  stop: () => void
}

export const shared_projection = <Value>({
  bus,
  channel,
  read,
  invalidates,
  sample_interval_ms = 0,
}: Readonly<{
  bus: Pick<Bus, 'emitter' | 'subscribe' | 'unsubscribe'>
  channel: (key: string) => string
  read: (key: string, previous: Value | undefined) => Promise<Value>
  invalidates: (event: EventEnvelope, key: string) => boolean
  /** Nonzero allows bounded-age samples, even when another invalidation arrives during a read. */
  sample_interval_ms?: number
}>) => {
  const entries = new Map<string, Entry<Value>>()
  const accepts_result =
    sample_interval_ms > 0 ? () => true : (revision: number, current: number) => revision === current
  const evict_idle = (key: string, entry: Entry<Value>): void => {
    if (entry.closed || entry.consumers.size || entry.running) return
    const remaining = sample_interval_ms - (performance.now() - entry.last_started)
    if (remaining <= 0) {
      entry.stop()
      return
    }
    entry.timer = setTimeout(() => {
      entry.timer = null
      evict_idle(key, entry)
    }, remaining)
  }
  const request_refresh = (key: string, entry: Entry<Value>): void => {
    if (entry.running || !entry.subscribed || entry.closed) return
    const remaining = sample_interval_ms - (performance.now() - entry.last_started)
    if (remaining > 0) {
      entry.timer ??= setTimeout(() => {
        entry.timer = null
        request_refresh(key, entry)
      }, remaining)
      return
    }
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = null
    entry.last_started = performance.now()
    void refresh(key, entry)
  }
  const refresh = async (key: string, entry: Entry<Value>): Promise<void> => {
    entry.running = true
    const { revision } = entry
    try {
      const value = await read(key, entry.value)
      if (entry.closed || !accepts_result(revision, entry.revision)) return
      entry.value = value
      entry.current = revision
      entry.consumers.forEach(({ deliver }) => deliver(value))
    } catch (error) {
      entry.revision += Number(sample_interval_ms > 0)
      log.warn({ key, err: error }, 'public projection read failed')
      if (!entry.closed) entry.consumers.forEach(({ fail }) => fail(error))
    } finally {
      entry.running = false
      if (!entry.consumers.size) evict_idle(key, entry)
      else if (!entry.closed && revision !== entry.revision) request_refresh(key, entry)
    }
  }

  const acquire = (key: string): Entry<Value> => {
    const topic = channel(key)
    let owns_subscription = false
    let subscription_generation = 0
    const on_event = (event: EventEnvelope): void => {
      if (!invalidates(event, key)) return
      entry.revision++
      request_refresh(key, entry)
    }
    const entry: Entry<Value> = {
      consumers: new Set(),
      value: undefined,
      revision: 0,
      current: 0,
      last_started: Number.NEGATIVE_INFINITY,
      timer: null,
      running: false,
      subscribed: false,
      closed: false,
      ready: Promise.resolve(),
      resume: () => {
        const generation = ++subscription_generation
        if (entry.timer !== null) clearTimeout(entry.timer)
        entry.timer = null
        // An idle interval may have missed changes, so refresh after the retained deadline.
        entry.revision++
        bus.emitter.on(topic, on_event)
        entry.ready = entry.ready
          .then(async () => {
            await bus.subscribe(topic)
            owns_subscription = true
            if (generation !== subscription_generation) return
            entry.subscribed = true
            request_refresh(key, entry)
          })
          .catch((error: unknown) => {
            log.warn({ key, err: error }, 'public projection subscription failed')
            if (generation !== subscription_generation) return
            entry.consumers.forEach(({ fail }) => fail(error))
            entry.stop()
          })
      },
      pause: () => {
        subscription_generation++
        entry.subscribed = false
        if (entry.timer !== null) clearTimeout(entry.timer)
        entry.timer = null
        bus.emitter.off(topic, on_event)
        // Serialize release/reacquire even when the first subscription is still pending.
        entry.ready = entry.ready
          .then(async () => {
            if (!owns_subscription) return
            owns_subscription = false
            await bus.unsubscribe(topic)
          })
          .catch((error: unknown) => log.error({ err: error, topic }, 'projection unsubscribe failed'))
      },
      stop: () => {
        if (entry.closed) return
        entry.closed = true
        entry.pause()
        entries.delete(key)
      },
    }
    entries.set(key, entry)
    return entry
  }
  return Object.freeze({
    get: (key: string): Value | undefined => entries.get(key)?.value,
    watch: (key: string, deliver: Consumer<Value>['deliver'], fail: Consumer<Value>['fail']): (() => void) => {
      const entry = entries.get(key) ?? acquire(key)
      const consumer = { deliver, fail }
      entry.consumers.add(consumer)
      if (entry.consumers.size === 1) entry.resume()
      if (entry.value !== undefined && accepts_result(entry.current, entry.revision)) deliver(entry.value)
      else request_refresh(key, entry)
      return () => {
        if (!entry.consumers.delete(consumer) || entry.consumers.size) return
        if (sample_interval_ms === 0) {
          entry.stop()
          return
        }
        entry.pause()
        evict_idle(key, entry)
      }
    },
  })
}
