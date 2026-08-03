// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 WP4 — THE MONOTONIC RESULT RECORD, red-first against the #1867 class (loot repaint from a second source).
//
// #1867's symptom is one sentence: a loot row the player already saw changes — it shrinks, renames, or loses its
// icon — because a SECOND transport answers the same question after the first one committed. Settlement fans a
// result out over four independent arrivals (the ResultOpened floor, the minted ItemMinted instances, the
// FightResult object read, and the `/v1` bag repaint `load_roster()` fires at the tail of finish_result), and
// every one of them used to be allowed to overwrite the visible answer.
//
// Two arms, both driven through the REAL production doors:
//   ARM A — the reducer: a later object read carrying a SHORTER `rolled` declaration than the receipt that
//           opened the card. Not hypothetical: `mint_all_and_burn` DRAINS `rolled` one entry per `mint_rolled`
//           (results.move), so a read at the tail of settlement legitimately observes fewer rows than the
//           receipt did — player_experience.js's own header says so. Same richness class (`resolved: true`), so
//           every guard the slice held before this lane waved it straight through and the list SHRANK.
//   ARM B — the render join: a committed loot tile re-resolved against the LIVE bag. `resolve_loot_tile` reads
//           `state.sui.items` for identity, so the `/v1` snapshot that lands after the card is already visible
//           (finding row 75) repaints a tile the player was looking at.
//
// The record's answer to both: a fact that has COMMITTED never regresses within the fight's lifetime. Later
// evidence may only ADD; a contradiction is not silently dropped either — it lands on `conflicts` as DATA.

import { describe, expect, test } from 'bun:test'

import player_experience from '../../src/game/core/modules/player_experience.js'
import { resolve_loot_tile } from '../../src/game/screens/hud/loot-tile-resolve.js'

const RESULT_ID = '0xresult_1867'

const module_fold = () => {
  const mod = player_experience({ refresh_character: async () => {} })
  return (slice, type, payload) => mod.reduce({ fight_result: slice }, { type, payload }).fight_result
}

const row = (template_id, name, amount = 1, extra = {}) => ({
  template_id,
  item_type: 'resource',
  name,
  amount,
  ...extra,
})

describe('#1867 arm A — a later transport may never shrink a committed loot list', () => {
  test('the object read draining `rolled` cannot un-loot what the receipt already certified', () => {
    const fold = module_fold()
    let slice = fold(null, 'action/fight_result/open', { level: 7 })
    slice = fold(slice, 'action/fight_result/bind', { result_id: RESULT_ID })

    // ① the settlement receipt's own declaration — three drops, certified, visible on the card.
    const certified = [row('0xt_blade', 'Rusted Blade'), row('0xt_ore', 'Iron Ore', 3), row('0xt_pelt', 'Wolf Pelt')]
    slice = fold(slice, 'action/fight_result/loot', { result_id: RESULT_ID, loot: certified, resolved: true })
    expect(slice.loot.map((r) => r.template_id)).toEqual(['0xt_blade', '0xt_ore', '0xt_pelt'])

    // ② the display-tail object read, fired AFTER two of the three templates already minted-and-drained out of
    //    `rolled`. Same richness class, non-empty, so nothing before this lane refused it.
    slice = fold(slice, 'action/fight_result/loot', {
      result_id: RESULT_ID,
      loot: [row('0xt_pelt', 'Wolf Pelt')],
      resolved: true,
    })

    // MONOTONIC: the player keeps every row the receipt certified. A partial re-read ADDS or it says nothing.
    expect(slice.loot.map((r) => r.template_id)).toEqual(['0xt_blade', '0xt_ore', '0xt_pelt'])
  })

  test('a contradicting row lands on `conflicts` as data instead of vanishing', () => {
    const fold = module_fold()
    let slice = fold(null, 'action/fight_result/open', { level: 7 })
    slice = fold(slice, 'action/fight_result/bind', { result_id: RESULT_ID })
    slice = fold(slice, 'action/fight_result/loot', {
      result_id: RESULT_ID,
      loot: [row('0xt_ore', 'Iron Ore', 3)],
      resolved: true,
    })
    // the same template, a DIFFERENT quantity — one of the two reads is wrong and the record must not pick
    // silently. The committed value stands; the disagreement is retained for the operator.
    slice = fold(slice, 'action/fight_result/loot', {
      result_id: RESULT_ID,
      loot: [row('0xt_ore', 'Iron Ore', 1)],
      resolved: true,
    })

    expect(slice.loot).toEqual([expect.objectContaining({ template_id: '0xt_ore', amount: 3 })])
    expect(slice.conflicts).toHaveLength(1)
    expect(slice.conflicts[0]).toMatchObject({ key: 'loot', template_id: '0xt_ore' })
  })

  test('richer evidence still ADDS: exact minted instances upgrade the aggregate rows in place', () => {
    const fold = module_fold()
    let slice = fold(null, 'action/fight_result/open', { level: 7 })
    slice = fold(slice, 'action/fight_result/bind', { result_id: RESULT_ID })
    slice = fold(slice, 'action/fight_result/loot', {
      result_id: RESULT_ID,
      loot: [row('0xt_blade', 'Rusted Blade')],
      resolved: true,
    })
    slice = fold(slice, 'action/fight_result/loot', {
      result_id: RESULT_ID,
      loot: [row('0xt_blade', 'Rusted Blade', 1, { item_id: '0xitem_blade' })],
      resolved: true,
      instances: true,
    })

    expect(slice.loot).toEqual([expect.objectContaining({ template_id: '0xt_blade', item_id: '0xitem_blade' })])
    expect(slice.conflicts).toEqual([])
  })
})

describe('#1867 arm B — the live bag is not a source of loot identity', () => {
  // The exact drop the receipt certified, committed with its resolved tile.
  const entry = () => ({
    item_id: '0xitem_blade',
    template_id: '0xt_blade',
    item_type: 'resource',
    name: 'Rusted Blade',
    amount: 1,
  })
  const template_map = () => new Map([['0xt_blade', { name: 'Rusted Blade', item_type: 'blade', category: 'weapon' }]])
  const tt = (tmpl, field) => tmpl?.[field] ?? ''
  const t = (key) => key

  test('a `/v1` bag repaint after the card is visible cannot change the committed tile', () => {
    // BEFORE: the bag holds the freshly minted instance — the join resolves off it.
    const before = resolve_loot_tile(
      entry(),
      [{ id: '0xitem_blade', item_type: 'blade', name: 'Rusted Blade' }],
      template_map(),
      tt,
      t
    )
    // AFTER: `load_roster()` at the tail of finish_result repaints `sui.items`; the merge sweep folded this
    // singleton into a stack under a NEW object id, so the row the tile joined on is simply gone (D245's
    // mid-fight transient does the same thing from the other direction).
    const after = resolve_loot_tile(
      entry(),
      [{ id: '0xitem_stack', item_type: 'blade', name: 'Rusted Blade' }],
      template_map(),
      tt,
      t
    )

    // The player is looking at ONE drop. Two bag snapshots must not be two different tiles.
    expect(after).toEqual(before)
  })

  test('an exact committed tile is returned verbatim — the bag is never consulted for identity', () => {
    const empty_bag = resolve_loot_tile(entry(), [], template_map(), tt, t)
    expect(empty_bag.name).toBe('Rusted Blade')
    expect(empty_bag.item_id).toBe('0xitem_blade')
    expect(empty_bag.resolved).toBe(true)
  })
})
