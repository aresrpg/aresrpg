// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xreentrant'

const turn_started = () => ({
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: true, idx: 0, deadline_ms: 30_000 },
})

describe('the store input door serializes synchronous re-entry', () => {
  test('an input dispatched by a subscriber during a fold survives beside the outer input', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT }, 1)

    let reentered = false
    const unsubscribe = store.subscribe(() => {
      if (reentered) return
      reentered = true
      store
        .getState()
        .input({ type: 'receipt', fight_id: FIGHT, version: 1, receipt: { events: [turn_started()] } }, 101)
    })

    store.getState().input({ type: 'tick' }, 100)
    unsubscribe()

    const { core } = store.getState()
    expect(reentered).toBe(true)
    expect(core.clock.now_ms).toBe(100)
    expect(core.last_read?.source).toBe('receipt')
    expect(Object.keys(core.inbox.log)).toHaveLength(1)
  })
})
