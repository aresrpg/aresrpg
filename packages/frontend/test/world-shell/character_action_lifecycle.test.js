// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, describe, expect, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()
const pagehide_handlers = []
window.addEventListener = (type, handler) => {
  if (type === 'pagehide') pagehide_handlers.push(handler)
}
reset_auth_mock()

const { install_character_action_lifecycle, reset_character_action_lane, run_character_action } =
  await import('../../src/world-shell/tx.js')

afterAll(restore_browser_globals)

describe('character action lane page lifecycle', () => {
  test('a restored page does not inherit an unresolved lock from the previous document lifetime', async () => {
    // Another test/document may have entered the module first. The current Window still owns its own listener.
    install_character_action_lifecycle({ addEventListener() {} })
    const previous_page = Promise.withResolvers()
    const abandoned = run_character_action(() => previous_page.promise)

    await expect(run_character_action(async () => 'blocked')).rejects.toThrow(
      'Another character action is still in progress'
    )

    const pagehide = pagehide_handlers.find((handler) => handler === reset_character_action_lane)
    expect(pagehide).toBeFunction()
    pagehide()

    await expect(run_character_action(async () => 'fresh')).resolves.toBe('fresh')

    previous_page.resolve('old page settled late')
    await expect(abandoned).resolves.toBe('old page settled late')
    await expect(run_character_action(async () => 'still fresh')).resolves.toBe('still fresh')
  })
})
