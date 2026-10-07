// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, mock, test } from 'bun:test'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

const register = mock((_options: RegisterSWOptions) => {})
mock.module('virtual:pwa-register', () => ({ registerSW: register }))
const { register_service_worker } = await import('../src/pwa.ts')

const with_browser = async (
  run: (browser: {
    tab: EventTarget
    document: EventTarget & { visibilityState: string }
    navigator: { onLine: boolean }
    timers: { callback: () => void; interval: number }[]
    update: ReturnType<typeof mock<() => Promise<void>>>
  }) => Promise<void>
) => {
  const tab = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const navigator = { onLine: true }
  const timers: { callback: () => void; interval: number }[] = []
  const overrides = {
    document,
    navigator,
    addEventListener: tab.addEventListener.bind(tab),
    setInterval: (callback: () => void, interval: number) => timers.push({ callback, interval }),
  }
  const descriptors = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  const update = mock(async () => {})
  register.mockClear()
  try {
    Object.entries(overrides).forEach(([key, value]) =>
      Object.defineProperty(globalThis, key, { configurable: true, value })
    )
    await register_service_worker()
    register.mock.calls[0]![0].onRegisteredSW!('/sw.js', { update } as unknown as ServiceWorkerRegistration)
    await run({ tab, document, navigator, timers, update })
  } finally {
    Object.entries(descriptors).forEach(([key, descriptor]) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}
const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

test('an active game checks every fifteen seconds and on return or reconnect', () =>
  with_browser(async ({ tab, document, timers, update }) => {
    expect(timers[0]!.interval).toBe(15_000)
    for (const [target, event] of [
      [tab, 'focus'],
      [document, 'visibilitychange'],
      [tab, 'online'],
    ] as const) {
      target.dispatchEvent(new Event(event))
      await settled()
    }
    timers[0]!.callback()
    await settled()
    expect(update).toHaveBeenCalledTimes(4)
  }))

test('hidden, offline and overlapping checks do not produce duplicate requests', () =>
  with_browser(async ({ tab, document, navigator, timers, update }) => {
    document.visibilityState = 'hidden'
    timers[0]!.callback()
    expect(update).not.toHaveBeenCalled()
    document.visibilityState = 'visible'
    navigator.onLine = false
    tab.dispatchEvent(new Event('focus'))
    expect(update).not.toHaveBeenCalled()
    navigator.onLine = true
    tab.dispatchEvent(new Event('online'))
    tab.dispatchEvent(new Event('focus'))
    expect(update).toHaveBeenCalledTimes(1)
    await settled()
    timers[0]!.callback()
    expect(update).toHaveBeenCalledTimes(2)
  }))
