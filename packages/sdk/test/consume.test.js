// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #31 — the out-of-fight consumable USE builder (consume::use_many). OFFLINE: the deployment override seam
// (context.ids.aresrpg) builds the tx without a live publish; asserts the target + arg shape (12) + the single
// deterministic call (no &Random) + the loud refusals (undeployed / missing template / bad quantity). Mirrors
// game.test.js's builder-shape pattern.

import { describe, test, expect } from 'bun:test'

import { consume_potion_ptb } from '../src/sui/write/consume.js'

import {
  deployed_context,
  undeployed_context,
  id,
  find_call,
  targets,
  IDS,
} from './_onchain_fixtures.js'

const A = {
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  character_id: id('char'),
  item_id: id('potion'),
  template_id: id('tmpl'),
  quantity: 3,
}

describe('consume_potion_ptb — consume::use_many builder', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => consume_potion_ptb(undeployed_context)(A)).toThrow(
      /not deployed/,
    )
  })

  test('deployed → consume::use_many, 12 args, merged package, single deterministic call', () => {
    const tx = consume_potion_ptb(deployed_context)(A)
    const call = find_call(tx, 'consume::use_many')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(12)
    expect(targets(tx)).toEqual(['consume::use_many']) // one call, no &Random ⇒ freely composable
    expect(typeof tx.serialize()).toBe('string')
  })

  test('quantity defaults to 1 (single-tap) and still builds use_many with 12 args', () => {
    const { quantity, ...single } = A
    void quantity
    const call = find_call(
      consume_potion_ptb(deployed_context)(single),
      'consume::use_many',
    )
    expect(call.args).toBe(12)
  })

  test('refuses a missing template_id (no resolvable ItemTemplate for the potion)', () => {
    expect(() =>
      consume_potion_ptb(deployed_context)({ ...A, template_id: undefined }),
    ).toThrow(/template_id is required/)
  })

  test('refuses a missing item_id / character_id', () => {
    expect(() =>
      consume_potion_ptb(deployed_context)({ ...A, item_id: undefined }),
    ).toThrow(/character_id and item_id/)
    expect(() =>
      consume_potion_ptb(deployed_context)({ ...A, character_id: undefined }),
    ).toThrow(/character_id and item_id/)
  })

  test('refuses a missing kiosk_id / personal_kiosk_cap_id', () => {
    expect(() =>
      consume_potion_ptb(deployed_context)({ ...A, kiosk_id: undefined }),
    ).toThrow(/kiosk_id and personal_kiosk_cap_id/)
  })

  test('refuses a non-positive / non-integer quantity (blocked when pointless)', () => {
    expect(() =>
      consume_potion_ptb(deployed_context)({ ...A, quantity: 0 }),
    ).toThrow(/quantity must be an integer/)
    expect(() =>
      consume_potion_ptb(deployed_context)({ ...A, quantity: 1.5 }),
    ).toThrow(/quantity must be an integer/)
  })
})
