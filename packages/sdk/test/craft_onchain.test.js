// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// craft_ptb — the single-tx recipe craft builder. Offline: the merged-package ids are injected through the
// deployment override seam (context.ids.aresrpg), so the PTB BUILDS with no live publish, and we assert the frozen
// crafting::craft target + its 11-arg shape (adds character_id + the terminal &Random) against
// packages/move/aresrpg/sources/crafting.move.

import { describe, test, expect } from 'bun:test'

import { craft_ptb } from '../src/sui/write/craft.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

const args = {
  recipe_id: id('recipe'),
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  character_id: id('char'),
  input_item_ids: [id('ing1'), id('ing2')],
  output_template_id: id('outtpl'),
}

describe('craft_ptb — consume exact inputs, mint the output, one tx', () => {
  test('refuses loudly while the merged package is undeployed (no builder invents an id)', () => {
    expect(() => craft_ptb(undeployed_context)(args)).toThrow(/not deployed/)
  })

  test('refuses while EXTRACT_POLICY is unstamped (S-51b: the xpolicy is a deployment singleton now)', () => {
    const no_xpolicy = {
      ...deployed_context,
      ids: { aresrpg: { ...IDS.aresrpg, EXTRACT_POLICY: '' } },
    }
    expect(() => craft_ptb(no_xpolicy)(args)).toThrow(/EXTRACT_POLICY/)
  })

  test('refuses an empty ingredient list (a zero-input craft would be a free mint)', () => {
    expect(() =>
      craft_ptb(deployed_context)({ ...args, input_item_ids: [] }),
    ).toThrow(/input_item_ids/)
  })

  test('refuses a missing character_id (the reference-corpus success roll needs the crafter char)', () => {
    expect(() =>
      craft_ptb(deployed_context)({ ...args, character_id: undefined }),
    ).toThrow(/character_id/)
  })

  test('targets crafting::craft at LATEST with the frozen 11-arg shape (+ character_id, + &Random)', () => {
    const tx = craft_ptb(deployed_context)(args)
    expect(targets(tx)).toEqual(['header::aresrpg', 'crafting::craft'])
    const call = find_call(tx, 'crafting::craft')
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(11)
  })

  test('is a pure offline builder (deterministic — same args build the same tx)', () => {
    const a = targets(craft_ptb(deployed_context)(args))
    const b = targets(craft_ptb(deployed_context)(args))
    expect(a).toEqual(b)
  })
})
