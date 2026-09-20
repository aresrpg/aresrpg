// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A watched public projection has one subscription/read lifetime, regardless of viewer count.
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
  running: boolean
  subscribed: boolean
  closed: boolean
  ready: Promise<void>
  stop: () => void
}

export const shared_projection = <Value>({
  bus,
  channel,
  read,
  invalidates,
}: Readonly<{
  bus: Pick<Bus, 'emitter' | 'subscribe' | 'unsubscribe'>
  channel: (key: string) => string
  read: (key: string, previous: Value | undefined) => Promise<Value>
  invalidates: (event: EventEnvelope, key: string) => boolean
}>) => {
  const entries = new Map<string, Entry<Value>>()
  const refresh = async (key: string, entry: Entry<Value>): Promise<void> => {
    if (entry.running || !entry.subscribed || entry.closed) return
    entry.running = true
    const { revision } = entry
    try {
      const value = await read(key, entry.value)
      if (entry.closed || revision !== entry.revision) return
      entry.value = value
      entry.current = revision
      entry.consumers.forEach(({ deliver }) => deliver(value))
    } catch (error) {
      log.warn({ key, err: error }, 'public projection read failed')
      if (!entry.closed) entry.consumers.forEach(({ fail }) => fail(error))
    } finally {
      entry.running = false
      if (!entry.closed && revision !== entry.revision) void refresh(key, entry)
    }
  }

  const acquire = (key: string): Entry<Value> => {
    const topic = channel(key)
    const entry: Entry<Value> = {
      consumers: new Set(),
      value: undefined,
      revision: 1,
      current: 0,
      running: false,
      subscribed: false,
      closed: false,
      ready: Promise.resolve(),
      stop: () => {
        if (entry.closed) return
        entry.closed = true
        entries.delete(key)
        bus.emitter.off(topic, on_event)
        void entry.ready
          .then(async () => {
            if (entry.subscribed) await bus.unsubscribe(topic)
          })
          .catch((error: unknown) => log.error({ err: error, topic }, 'projection unsubscribe failed'))
      },
    }
    entries.set(key, entry)
    const on_event = (event: EventEnvelope): void => {
      if (!invalidates(event, key)) return
      entry.revision++
      void refresh(key, entry)
    }
    bus.emitter.on(topic, on_event)
    entry.ready = bus
      .subscribe(topic)
      .then(() => {
        entry.subscribed = true
        void refresh(key, entry)
      })
      .catch((error: unknown) => {
        log.warn({ key, err: error }, 'public projection subscription failed')
        if (!entry.closed) entry.consumers.forEach(({ fail }) => fail(error))
        entry.stop()
      })
    return entry
  }
  return Object.freeze({
    get: (key: string): Value | undefined => entries.get(key)?.value,
    watch: (key: string, deliver: Consumer<Value>['deliver'], fail: Consumer<Value>['fail']): (() => void) => {
      const entry = entries.get(key) ?? acquire(key)
      const consumer = { deliver, fail }
      entry.consumers.add(consumer)
      if (entry.value !== undefined && entry.current === entry.revision) deliver(entry.value)
      else void refresh(key, entry)
      return () => {
        if (!entry.consumers.delete(consumer) || entry.consumers.size) return
        entry.stop()
      }
    },
  })
}
