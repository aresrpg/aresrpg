// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  enter_after_world_join_receipt,
  fight_sync_delay_ms,
  poll_receipt_fight,
  receipt_entry_decision,
  should_hold_receipt_fight,
} from './world_fight_receipt.js'

describe('receipt-first world fight convergence', () => {
  test('the same receipt id is idempotent and a different live session is never stomped', () => {
    expect(
      receipt_entry_decision({
        current_fight_id: 'fight-1',
        current_run_pass_id: null,
        next_fight_id: 'fight-1',
        character_id: 'char-1',
      })
    ).toBe('same')
    expect(
      receipt_entry_decision({
        current_fight_id: 'fight-1',
        current_run_pass_id: null,
        next_fight_id: 'fight-2',
        character_id: 'char-1',
      })
    ).toBe('busy')
  })

  test('an unreadable receipt-owned Fight is held instead of being misclassified as destroyed', () => {
    expect(should_hold_receipt_fight({ fight_id: 'fight-1', fight_syncing: true }, 'fight-1')).toBe(true)
    expect(should_hold_receipt_fight({ fight_id: 'fight-1', fight_syncing: false }, 'fight-1')).toBe(false)
  })

  test('retry delay backs off and caps without imposing an attempt cap', () => {
    expect(Array.from({ length: 8 }, (_, i) => fight_sync_delay_ms(i))).toEqual([
      250, 500, 1000, 2000, 4000, 8000, 8000, 8000,
    ])
  })

  test('polls past the old one-shot window until the full board hydrates', async () => {
    const state = { fight_id: 'fight-1', fight_syncing: true, dungeon: null }
    const delays = []
    let reads = 0
    const result = await poll_receipt_fight({
      fight_id: 'fight-1',
      get_state: () => state,
      refresh: async () => {
        reads += 1
        if (reads === 2) throw new Error('temporary serving-node miss')
        if (reads === 10) {
          state.dungeon = { id: 'fight-1' }
          state.fight_syncing = false
        }
      },
      sleep: async (ms) => delays.push(ms),
    })
    expect(result).toBe('hydrated')
    expect(reads).toBe(10)
    expect(delays).toEqual([250, 500, 1000, 2000, 4000, 8000, 8000, 8000, 8000])
  })

  // RED-FIRST (#242 read-layer census): "the fight-engage receipt poll retrying uncapped" — the docstring
  // itself used to say "no attempt ceiling ... forever." A fight whose full-board read never becomes readable
  // (indexer stuck, genuinely dead) drove chain-direct reads every 8s forever, on top of the SEPARATE 4s
  // dungeon_run_store heartbeat (world_fight.js's _start_polling) already running in parallel. The ceiling
  // stops the tight duplicate loop; the honest "still syncing" state is never silently cleared, and the
  // slower 4s heartbeat (unaffected by this poll's own outcome) is the one thing left converging it.
  test('gives up after a total-wait ceiling instead of retrying forever, without silently un-syncing', async () => {
    const state = { fight_id: 'fight-1', fight_syncing: true, dungeon: null }
    let clock = 0
    let reads = 0
    const result = await poll_receipt_fight({
      fight_id: 'fight-1',
      get_state: () => state,
      refresh: async () => {
        reads += 1
        // Safety terminator FAR past any reasonable ceiling — proves the loop is bounded by TIME, not by
        // eventually being handed a hydration side effect. Never reached once the ceiling is respected.
        if (reads > 50) {
          state.dungeon = { id: 'fight-1' }
          state.fight_syncing = false
        }
      },
      sleep: async (ms) => {
        clock += ms
      },
      now: () => clock,
    })
    expect(result).toBe('timed_out')
    expect(reads).toBeLessThan(10)
    expect(state.fight_syncing).toBe(true) // never a lie that it resolved — FightSyncIndicator keeps showing
  })

  test('an executed join enters from its receipt, while a rejected join never enters', async () => {
    const entered = []
    const receipt = { effects: { status: { status: 'success' } } }
    await expect(
      enter_after_world_join_receipt({
        execute: async () => receipt,
        enter: (args) => entered.push(args),
        fight_id: 'fight-1',
        world_id: 'world-1',
        character_id: 'char-1',
      })
    ).resolves.toBe(receipt)
    expect(entered).toEqual([{ fight_id: 'fight-1', world_id: 'world-1', character_id: 'char-1' }])

    await expect(
      enter_after_world_join_receipt({
        execute: async () => {
          throw new Error('join rejected')
        },
        enter: (args) => entered.push(args),
        fight_id: 'fight-2',
        character_id: 'char-2',
      })
    ).rejects.toThrow('join rejected')
    expect(entered).toHaveLength(1)
  })
})
