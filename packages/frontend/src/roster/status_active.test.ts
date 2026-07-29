// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'
import { STATUS_ACTIVE as CHAIN_STATUS_ACTIVE } from '@aresrpg/fight/board_state'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const restore_browser = install_browser_globals()
const { STATUS_ACTIVE: ROSTER_STATUS_ACTIVE } = await import('./store')
restore_browser()

const active_run = <Run extends { status: number }>(run: Run): Run | null =>
  run.status === ROSTER_STATUS_ACTIVE ? run : null

describe('roster active status', () => {
  it('admits the canonical active run to HUD consumers', () => {
    const run = { status: CHAIN_STATUS_ACTIVE, carried_hp: 37, max_hp: 50, char_level: 8 }
    expect(active_run(run)).toBe(run)
  })
})
