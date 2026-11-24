// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Public projections share reads across viewers: an entry reads once, re-reads on each invalidating
// event, delivers only its newest read, and stops with its last consumer.
/* eslint-disable no-param-reassign -- This subscription lifecycle owns private entries; callers never receive them. */
import type { Bus } from './pubsub_bus.ts'
import type { EventEnvelope } from './protocol.ts'
import logger from './logger.ts'

const log = logger(import.meta)
type Consumer<Value> = Readonly<{ deliver: (value: Value) => void; fail: (error: unknown) => void }>
/** `subscribing` until Redis confirms the channel, then `subscribed`; `closed` once its last consumer left. */
type Phase = 'subscribing' | 'subscribed' | 'closed'
type Entry<Value> = {
  consumers: Set<Consumer<Value>>
  value: Value | undefined
  /** Invalidations seen, and the one `value` answers: the value is fresh when they are equal. */
  revision: number
  current: number
  running: boolean
  phase: Phase
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
  const request_refresh = (key: string, entry: Entry<Value>): void => {
    if (!entry.running && entry.phase === 'subscribed') void refresh(key, entry)
  }
  const refresh = async (key: string, entry: Entry<Value>): Promise<void> => {
    entry.running = true
    const { revision } = entry
    try {
      const value = await read(key, entry.value)
      if (entry.phase === 'closed' || revision !== entry.revision) return
      entry.value = value
      entry.current = revision
      entry.consumers.forEach(({ deliver }) => deliver(value))
    } catch (error) {
      log.warn({ key, err: error }, 'public projection read failed')
      if (entry.phase !== 'closed') entry.consumers.forEach(({ fail }) => fail(error))
    } finally {
      entry.running = false
      if (!entry.consumers.size) entry.stop()
      else if (revision !== entry.revision) request_refresh(key, entry)
    }
  }

  /** One entry per key: it subscribes once, and its stop releases only a subscription that succeeded. */
  const acquire = (key: string): Entry<Value> => {
    const topic = channel(key)
    const on_event = (event: EventEnvelope): void => {
      if (!invalidates(event, key)) return
      entry.revision++
      request_refresh(key, entry)
    }
    const subscription = bus.subscribe(topic)
    const entry: Entry<Value> = {
      consumers: new Set(),
      value: undefined,
      revision: 0,
      current: 0,
      running: false,
      phase: 'subscribing',
      stop: () => {
        if (entry.phase === 'closed') return
        entry.phase = 'closed'
        entries.delete(key)
        bus.emitter.off(topic, on_event)
        void subscription
          .then(
            () => bus.unsubscribe(topic),
            () => undefined
          )
          .catch((error: unknown) => log.error({ err: error, topic }, 'projection unsubscribe failed'))
      },
    }
    bus.emitter.on(topic, on_event)
    void subscription.then(
      () => {
        if (entry.phase === 'closed') return
        entry.phase = 'subscribed'
        request_refresh(key, entry)
      },
      (error: unknown) => {
        log.warn({ key, err: error }, 'public projection subscription failed')
        if (entry.phase === 'closed') return
        entry.consumers.forEach(({ fail }) => fail(error))
        entry.stop()
      }
    )
    entries.set(key, entry)
    return entry
  }
  return Object.freeze({
    get: (key: string): Value | undefined => entries.get(key)?.value,
    watch: (key: string, deliver: Consumer<Value>['deliver'], fail: Consumer<Value>['fail']): (() => void) => {
      const entry = entries.get(key) ?? acquire(key)
      const consumer = { deliver, fail }
      entry.consumers.add(consumer)
      if (entry.value !== undefined && entry.current === entry.revision) deliver(entry.value)
      else request_refresh(key, entry)
      return () => {
        if (entry.consumers.delete(consumer) && !entry.consumers.size) entry.stop()
      }
    },
  })
}
