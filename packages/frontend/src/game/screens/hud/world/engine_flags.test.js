// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The live-apply bridge's FIGHT-BLOCK guard (docs/design/hack_mode_spec.md §1.5): a graduated graphics flag
// applies live by re-creating the world session in place, and a live dungeon/fight owns the board + cave, so
// the swap is refused — the persisted value REVERTS and the player is toasted rather than left with a saved
// setting that does not match what is running (no silent failure). The guard is shared by every wireable
// flag; hack mode is the newest rider on it.
//
// The session/toast effects are INJECTED (apply_wireable_flag's last argument) so this drives the real guard
// with zero process-global mock.module stubs — the same "inject the edges" idiom shadow_enabled_from uses.

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { install_browser_globals } from '../../../../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true })
const { apply_wireable_flag } = await import('./engine_flags.js')
afterAll(restore_browser_globals)

/** A recording stand-in for the live session + toast edges. @param {any} reboot_result */
const effects_stub = (reboot_result, has_session = true) => {
  const calls = { reboots: 0, toasts: /** @type {string[]} */ ([]) }
  return {
    calls,
    load: async () => ({
      has_session: () => has_session,
      reboot: () => {
        calls.reboots += 1
        return reboot_result
      },
      toast: (/** @type {string} */ title) => void calls.toasts.push(title),
    }),
  }
}

describe('apply_wireable_flag — the shared live-apply guard', () => {
  let saved = false
  const get_previous = () => saved
  const persist = (/** @type {boolean} */ v) => {
    saved = v
  }
  beforeEach(() => {
    saved = false
  })

  it('a live fight refuses the swap: the persisted value reverts, the player is toasted, false is returned', async () => {
    const fx = effects_stub({ ok: false, reason: 'fight' })
    expect(await apply_wireable_flag(get_previous, persist, true, fx.load)).toBe(false)
    expect(saved).toBe(false) // reverted — never left claiming a mode the session is not running
    expect(fx.calls.toasts).toHaveLength(1)
  })

  it('a clean session applies: value stays persisted, the session reboots once, true is returned', async () => {
    const fx = effects_stub({ ok: true })
    expect(await apply_wireable_flag(get_previous, persist, true, fx.load)).toBe(true)
    expect(saved).toBe(true)
    expect(fx.calls.reboots).toBe(1)
    expect(fx.calls.toasts).toHaveLength(0)
  })

  it('no live session ⇒ persist only, nothing to reboot (the value applies on the next boot)', async () => {
    const fx = effects_stub({ ok: false, reason: 'no_session' }, false)
    expect(await apply_wireable_flag(get_previous, persist, true, fx.load)).toBe(true)
    expect(saved).toBe(true)
    expect(fx.calls.reboots).toBe(0)
  })

  it('setting the value it already has is a no-op — no reboot, no persist churn', async () => {
    const fx = effects_stub({ ok: true })
    expect(await apply_wireable_flag(get_previous, persist, false, fx.load)).toBe(true)
    expect(fx.calls.reboots).toBe(0)
  })
})
