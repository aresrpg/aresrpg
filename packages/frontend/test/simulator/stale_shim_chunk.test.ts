// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE STALE-SHIM GATE — the live simulator report: "The local chain is not available in this build."
//
// The mechanism, measured against the served edge deploy: hashed chunks are retired by every deploy, and
// `vercel.json` answers a retired path with the SPA shell (HTTP 200, `text/html`), so a tab opened before the
// deploy fails its next lazy import with
// `TypeError: Failed to fetch dynamically imported module: …/assets/fight_shim-<old hash>.js`.
// `useSimFight` defers the sim chain to exactly one such import, caught the rejection itself, and turned it
// into a verdict about THE BUILD — while the app's one stale-deploy recovery never heard about it, because a
// caught rejection raises no `unhandledrejection` and Vite's preload helper stops rethrowing the moment the
// recovery listener cancels the event.
//
// Both halves are pinned here: the failure REPORTS to the single recovery door, and the reason names the tab's
// staleness instead of blaming the build the player cannot see.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import en from '../../src/i18n/locales/en.json'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })
// The shared stub's window cannot dispatch; the door under test is a dispatch, so it needs the real target.
const window_events = new EventTarget()
Object.assign(globalThis.window as object, {
  addEventListener: window_events.addEventListener.bind(window_events),
  removeEventListener: window_events.removeEventListener.bind(window_events),
  dispatchEvent: window_events.dispatchEvent.bind(window_events),
})

afterAll(restore_browser_globals)

const { on_shim_load_failure } = await import('../../src/simulator/use_sim_fight.js')

describe('a shim chunk the deploy retired', () => {
  test('reports to the ONE stale-deploy recovery door instead of swallowing the failure', () => {
    const events: Event[] = []
    const listener = (event: Event) => events.push(event)
    window_events.addEventListener('vite:preloadError', listener)
    try {
      on_shim_load_failure()
    } finally {
      window_events.removeEventListener('vite:preloadError', listener)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('vite:preloadError')
    // The recovery answers by cancelling the event; a report it cannot cancel is a report it cannot own.
    expect(events[0].cancelable).toBe(true)
  })

  test('blocks with the STALE PAGE reason, never a verdict about the build', () => {
    expect(on_shim_load_failure()).toBe('stale_build')

    const { simulator } = en as Record<string, Record<string, string>>
    expect(typeof simulator.fight_blocked_stale_build).toBe('string')
    expect(simulator.fight_blocked_sim_chain_missing).toBeUndefined()
    expect(simulator.fight_blocked_stale_build).not.toMatch(/this build/i)
  })
})
