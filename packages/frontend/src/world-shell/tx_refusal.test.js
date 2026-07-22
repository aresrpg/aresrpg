// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STRICT SPONSOR UPGRADE — a retired-package refusal is an async tx result, so it must re-enter the
// game state as ONE reducer input. The tx catch never writes a store and the modal never guesses from copy.
import { describe, expect, test } from 'bun:test'

import player from '../game/core/modules/player.js'

import { tx_refusal_input } from './tx_refusal.js'

const retired_package_refusal = () =>
  Object.assign(new Error('AresRPG was upgraded'), { sponsor_refusal: 'outdated-package' })

describe('strict sponsor upgrade refusal → blocking modal state', () => {
  test('the machine refusal becomes one reducer input that latches the upgrade modal open', () => {
    const input = tx_refusal_input(retired_package_refusal())

    expect(input).toEqual({ type: 'action/sponsor_upgrade_required', payload: true })
    expect(player().reduce({ sponsor_upgrade_required: false }, input)).toEqual({
      sponsor_upgrade_required: true,
    })
  })

  test('an ordinary sponsor-scope error cannot impersonate the outdated-package refusal', () => {
    expect(tx_refusal_input(new Error('sponsor-scope: non-allowlisted package'))).toBeNull()
  })

  test('the direct sponsored onboarding wrapper dispatches the same reducer input before rethrowing', async () => {
    // Auth registration is intentionally browser-owned, so this DOM-less test pins the tiny wrapper seam by
    // source contract while the pure mapping + real player reducer above prove its behavior.
    const source = await Bun.file(new URL('../auth/index.ts', import.meta.url)).text()
    const start = source.indexOf('export async function sponsor_and_execute_transaction')
    const end = source.indexOf('// The zkLogin `address_seed`', start)
    const wrapper = source.slice(start, end)

    expect(wrapper).toContain('const refusal_input = tx_refusal_input(error)')
    expect(wrapper).toContain('dispatch_action(refusal_input.type, refusal_input.payload)')
    expect(wrapper.indexOf('dispatch_action')).toBeLessThan(wrapper.lastIndexOf('throw error'))
  })

  test('the modal projects reducer state and only offers a page reload', async () => {
    const source = await Bun.file(new URL('../components/sponsor_upgrade_modal.tsx', import.meta.url)).text()

    expect(source).toContain('state.sponsor_upgrade_required')
    expect(source).toContain('window.location.reload()')
    expect(source).not.toContain("e.key === 'Escape'")
    expect(source).not.toContain('on_close')
  })
})
