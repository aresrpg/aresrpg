// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// craft_ptb — the single-tx recipe craft builder. Offline: the merged-package ids are injected through the
// deployment override seam (context.ids.aresrpg), so the PTB BUILDS with no live publish, and we assert the frozen
// per-item extract::extract_for_burn composition + the terminal crafting::craft call.

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

/** Resolve a built MoveCall Input argument to its underlying object id. */
function arg_object_id(tx, arg) {
  if (arg?.$kind !== 'Input') return null
  const input = tx.getData().inputs[arg.Input]
  return (
    input?.UnresolvedObject?.objectId ??
    input?.Object?.SharedObject?.objectId ??
    input?.Object?.ImmOrOwnedObject?.objectId ??
    null
  )
}

const args = {
  recipe_id: id('recipe'),
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  character_id: id('char'),
  input_items: [
    {
      id: id('ing1'),
      kiosk_id: id('kiosk'),
      kiosk_cap_id: id('pkcap'),
    },
    {
      id: id('ing2'),
      kiosk_id: id('kiosk'),
      kiosk_cap_id: id('pkcap'),
    },
  ],
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
      craft_ptb(deployed_context)({ ...args, input_items: [] }),
    ).toThrow(/input_items/)
  })

  test('refuses a missing character_id (the reference-corpus success roll needs the crafter char)', () => {
    expect(() =>
      craft_ptb(deployed_context)({ ...args, character_id: undefined }),
    ).toThrow(/character_id/)
  })

  test('extracts the inputs, then targets crafting::craft at LATEST with the frozen 11-arg shape', () => {
    const tx = craft_ptb(deployed_context)(args)
    expect(targets(tx)).toEqual([
      'extract::extract_for_burn',
      'extract::extract_for_burn',
      'vector::singleton',
      'vector::push_back',
      'vector::singleton',
      'vector::push_back',
      'crafting::craft',
    ])
    const call = find_call(tx, 'crafting::craft')
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(11)
    expect(typeof tx.serialize()).toBe('string')
  })

  test('extracts each ingredient from its own custody kiosk', () => {
    const input_items = [
      {
        id: id('ing1'),
        kiosk_id: id('ing1-kiosk'),
        kiosk_cap_id: id('ing1-cap'),
      },
      {
        id: id('ing2'),
        kiosk_id: id('ing2-kiosk'),
        kiosk_cap_id: id('ing2-cap'),
      },
    ]
    const tx = craft_ptb(deployed_context)({ ...args, input_items })
    const extracts = tx
      .getData()
      .commands.filter(
        command =>
          command.$kind === 'MoveCall' &&
          command.MoveCall.module === 'extract' &&
          command.MoveCall.function === 'extract_for_burn',
      )

    expect(extracts).toHaveLength(2)
    expect(
      extracts.map(command => [
        arg_object_id(tx, command.MoveCall.arguments[0]),
        arg_object_id(tx, command.MoveCall.arguments[1]),
      ]),
    ).toEqual(
      input_items.map(({ kiosk_id, kiosk_cap_id }) => [
        kiosk_id,
        kiosk_cap_id,
      ]),
    )
  })

  test('is a pure offline builder (deterministic — same args build the same tx)', () => {
    const a = targets(craft_ptb(deployed_context)(args))
    const b = targets(craft_ptb(deployed_context)(args))
    expect(a).toEqual(b)
  })
})
