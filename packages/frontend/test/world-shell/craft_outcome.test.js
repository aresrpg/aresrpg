// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2034 — "crafted a pickaxe, resources consumed, no pickaxe". The chain behaved correctly: `crafting::craft`
// is a SUCCESS-ROLL door (inputs burn and job XP credits on EVERY attempt, the output mints only on a passing
// roll), and the reported craft FAILED its roll. The defect was the client's outcome report — the drawer
// toasted `craft_success` on TRANSACTION success, so a failed roll was announced as a win and the player went
// looking for an item that never existed.
//
// The discriminator is the receipt's own `crafting::Crafted` event (`success: bool`), and the fixture here is
// the REPORTED transaction itself, captured off testnet (see its `_provenance`, which carries the digest and
// notes that only the opaque object ids are redacted): effects.status SUCCESS, Crafted.success false.
// A tx-status read can never tell those apart — only the event can.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import failed_roll_receipt from '../fixtures/craft_receipt_failed_roll.json'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'
import {
  CRAFT_SUCCESS_BP_AT_LEVEL_1,
  CRAFT_SUCCESS_BP_CAP,
  craft_outcome,
  craft_success_rate_bp,
} from '../../src/world-shell/craft_outcome.js'

/** The captured receipt with its Crafted event flipped to a passing roll (no successful craft exists on
 *  testnet yet — every other field, and every sibling event, stays exactly as captured). */
const passed_roll_receipt = {
  ...failed_roll_receipt,
  events: failed_roll_receipt.events.map((event) =>
    event.type.endsWith('::crafting::Crafted')
      ? { ...event, parsedJson: { ...event.parsedJson, success: true, output_quantity: '1' } }
      : event
  ),
}

describe('#2034 craft outcome — the receipt, not the transaction status', () => {
  test('the REPORTED receipt reads as a FAILED roll, though the transaction succeeded', () => {
    expect(failed_roll_receipt.effects.status.status).toBe('success')
    expect(craft_outcome(failed_roll_receipt)).toEqual({ outcome: 'failure', quantity: 0 })
  })

  test('a passing roll reads as a success and carries the minted quantity', () => {
    expect(craft_outcome(passed_roll_receipt)).toEqual({ outcome: 'success', quantity: 1 })
  })

  // NEVER coerce a missing signal into a plausible answer: a receipt with no Crafted event is unknown, and
  // announcing an unproven success is the exact bug this row exists to kill.
  test('a receipt without the Crafted event is UNKNOWN, never an assumed success', () => {
    expect(craft_outcome({ digest: '0xd', events: [] })).toEqual({ outcome: 'unknown', quantity: 0 })
    expect(craft_outcome(null)).toEqual({ outcome: 'unknown', quantity: 0 })
  })
})

// The seam itself: the craft action hands its caller the OUTCOME, not a raw receipt the UI has to interpret
// (failures flow as data). Before this row it returned the receipt and the caller toasted "Crafted X" off the
// mere fact that the promise resolved — a resolved promise being exactly what a failed roll also produces.
describe('#2034 craft_item reports the roll outcome, not "the transaction resolved"', () => {
  const character_handle = { kiosk_id: '0xcharacter-kiosk', personal_kiosk_cap_id: '0xcharacter-cap' }
  const recipe = {
    recipe_id: '0xrecipe',
    output_template_id: '0xoutput',
    ingredients: [{ id: 'iron_ore', qty: 2 }],
  }
  const bag = [
    {
      id: '0xore',
      item_type: 'iron_ore',
      amount: 2,
      kiosk_id: character_handle.kiosk_id,
      kiosk_cap_id: character_handle.personal_kiosk_cap_id,
    },
  ]

  let spies = []
  let kiosk_resolve
  let tx_seam
  let roster
  let craft_item

  beforeEach(async () => {
    kiosk_resolve = await import('../../src/world-shell/kiosk_resolve.js')
    tx_seam = await import('../../src/world-shell/tx.js')
    roster = await import('../../src/roster/load_roster.js')
    ;({ craft_item } = await import('../../src/world-shell/craft_actions.js'))
    reset_auth_mock({ address: '0xowner', wallet_name: 'zklogin' })
    set_expedition_sdk_mock(async () => ({ craft_ptb: () => ({ fake: 'craft-tx' }) }))
    spies = [
      spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(character_handle),
      spyOn(tx_seam, 'run_tx').mockResolvedValue({ result: failed_roll_receipt }),
      spyOn(roster, 'load_roster').mockResolvedValue(undefined),
    ]
  })

  afterEach(() => {
    for (const spy of [...spies].reverse()) spy.mockRestore()
    spies = []
    reset_expedition_sdk_mock()
    reset_auth_mock()
  })

  test('the reported failed roll comes back as a FAILURE the caller can report honestly', async () => {
    await expect(craft_item({ recipe, items: bag, character_id: '0xcharacter' })).resolves.toEqual({
      outcome: 'failure',
      quantity: 0,
    })
  })

  // The bag repaint rides BOTH branches: job XP moved either way, so the drawer must re-read chain truth
  // even when nothing minted.
  test('a failed roll still repaints the bag (XP moved on chain)', async () => {
    await craft_item({ recipe, items: bag, character_id: '0xcharacter' })
    expect(roster.load_roster).toHaveBeenCalledTimes(1)
  })
})

describe('#2034 craft success chance — the client mirror of crafting.move y91', () => {
  // crafting.move:409 — y91(level) = min(9900, 5000 + (level-1) * 50) basis points.
  test('50% at job level 1, +0.5%/level, capped at 99%', () => {
    expect(craft_success_rate_bp(1)).toBe(CRAFT_SUCCESS_BP_AT_LEVEL_1)
    expect(craft_success_rate_bp(1)).toBe(5000)
    expect(craft_success_rate_bp(2)).toBe(5050)
    expect(craft_success_rate_bp(50)).toBe(7450)
    expect(craft_success_rate_bp(99)).toBe(9900)
    expect(craft_success_rate_bp(100)).toBe(CRAFT_SUCCESS_BP_CAP)
  })

  test('a level below 1 or an unreadable level clamps to the level-1 floor', () => {
    expect(craft_success_rate_bp(0)).toBe(5000)
    expect(craft_success_rate_bp(-3)).toBe(5000)
    expect(craft_success_rate_bp(Number.NaN)).toBe(5000)
  })
})
