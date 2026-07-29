// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// craft_ptb — the single-tx recipe craft builder. Offline: the merged-package ids are injected through the
// deployment override seam (context.ids.aresrpg), so the PTB BUILDS with no live publish.
//
// THE GATE (#1494): the composed call is asserted against `fixtures/crafting_craft_signature.json` — the
// DEPLOYED `crafting::craft` signature, captured off the live package through
// `MovePackageService/GetFunction` (provenance in the fixture). A builder that composes a shape the chain does
// not implement is the exact regression this file exists to catch: the previous composition invented a
// `(vector<Item>, vector<BurnPledge>)` overload that exists in no package, so every craft tx failed to build.

import { describe, test, expect } from 'bun:test'

import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'

import { craft_ptb } from '../src/sui/write/craft.js'

import signature from './fixtures/crafting_craft_signature.json' with { type: 'json' }
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

/** 'pure' | 'object' | 'result' for one built MoveCall argument — the PTB-side mirror of a Move param kind. */
function arg_kind(tx, arg) {
  if (arg?.$kind === 'Result' || arg?.$kind === 'NestedResult') return 'result'
  if (arg?.$kind !== 'Input') return String(arg?.$kind)
  return tx.getData().inputs[arg.Input]?.Pure ? 'pure' : 'object'
}

/** The raw MoveCall command (arguments included) for `module::function`. */
function raw_call(tx, target) {
  const command = tx
    .getData()
    .commands.find(
      c =>
        c.$kind === 'MoveCall' &&
        `${c.MoveCall.module}::${c.MoveCall.function}` === target,
    )
  if (!command) throw new Error(`no ${target} call in the built tx`)
  return command.MoveCall
}

/** Decode a `vector<ID>` pure argument back to its ids (built inputs carry base64 BCS bytes). */
function pure_id_vector(tx, arg) {
  const input = tx.getData().inputs[arg.Input]
  if (!input?.Pure) throw new Error('argument is not a pure input')
  const { bytes } = input.Pure
  return bcs
    .vector(bcs.Address)
    .parse(typeof bytes === 'string' ? fromBase64(bytes) : Uint8Array.from(bytes))
}

const args = {
  recipe_id: id('recipe'),
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  character_id: id('char'),
  input_items: [
    { id: id('ing1'), kiosk_id: id('kiosk'), kiosk_cap_id: id('pkcap') },
    { id: id('ing2'), kiosk_id: id('kiosk'), kiosk_cap_id: id('pkcap') },
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

  // ── THE TWIN GATE: the composed shape must be the shape the deployed package implements ──────────────
  test('composes ONE crafting::craft call matching the captured deployed signature', () => {
    const tx = craft_ptb(deployed_context)(args)
    // The chain extracts the ingredients itself (crafting::y18) — the PTB must NOT pre-extract them.
    expect(targets(tx)).toEqual(['crafting::craft'])

    const call = find_call(tx, 'crafting::craft')
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(signature.ptb_arg_kinds.length)

    const { arguments: composed } = raw_call(tx, 'crafting::craft')
    expect(composed.map(arg => arg_kind(tx, arg))).toEqual(
      signature.ptb_arg_kinds,
    )
  })

  test('threads the ingredient ids as the vector<ID> the chain burns, and the xpolicy it extracts through', () => {
    const tx = craft_ptb(deployed_context)(args)
    const { arguments: composed } = raw_call(tx, 'crafting::craft')

    expect(pure_id_vector(tx, composed[4])).toEqual([id('ing1'), id('ing2')])
    expect(arg_object_id(tx, composed[1])).toBe(args.kiosk_id)
    expect(arg_object_id(tx, composed[2])).toBe(args.personal_kiosk_cap_id)
    expect(arg_object_id(tx, composed[5])).toBe(args.output_template_id)
    expect(arg_object_id(tx, composed[6])).toBe(IDS.aresrpg.EXTRACT_POLICY)
  })

  // ── #1494 / #1162: the deployed door extracts EVERY input from the ONE passed kiosk ──────────────────
  test('refuses an ingredient held in another kiosk instead of composing a doomed tx', () => {
    const input_items = [
      { id: id('ing1'), kiosk_id: id('kiosk'), kiosk_cap_id: id('pkcap') },
      { id: id('ing2'), kiosk_id: id('other'), kiosk_cap_id: id('othercap') },
    ]
    expect(() => craft_ptb(deployed_context)({ ...args, input_items })).toThrow(
      /kiosk/i,
    )
    // The refusal NAMES both kiosks — a silent or generic refusal is what sent players to the toast.
    expect(() =>
      craft_ptb(deployed_context)({ ...args, input_items }),
    ).toThrow(new RegExp(`${id('other')}[\\s\\S]*${id('kiosk')}|${id('kiosk')}[\\s\\S]*${id('other')}`))
  })

  test('accepts the flat id form for co-located callers (ids already in the passed kiosk)', () => {
    const tx = craft_ptb(deployed_context)({
      ...args,
      input_items: undefined,
      input_item_ids: [id('ing1'), id('ing2')],
    })
    const { arguments: composed } = raw_call(tx, 'crafting::craft')
    expect(pure_id_vector(tx, composed[4])).toEqual([id('ing1'), id('ing2')])
  })

  test('is a pure offline builder (deterministic — same args build the same tx)', () => {
    const a = targets(craft_ptb(deployed_context)(args))
    const b = targets(craft_ptb(deployed_context)(args))
    expect(a).toEqual(b)
  })
})
