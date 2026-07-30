// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  merge_stack_ptb,
  merge_stacks_ptb,
  split_stack_ptb,
} from '../src/sui/write/item_stacks.js'

import {
  IDS,
  deployed_context,
  find_call,
  id,
  targets,
  undeployed_context,
} from './_onchain_fixtures.js'

const stack_context = {
  kiosk_id: id('stack-kiosk'),
  personal_kiosk_cap_id: id('stack-cap'),
}

describe('locked stack shaping composers', () => {
  test('split targets the latest Ares door with all seven explicit arguments', () => {
    const tx = split_stack_ptb(deployed_context)({
      ...stack_context,
      item_id: id('split-source'),
      amount: 10,
    })
    expect(targets(tx)).toEqual(['extract::split_locked_stack'])
    const call = find_call(tx, 'extract::split_locked_stack')
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(7)
  })

  test('merge targets the re-locking door with all seven explicit arguments', () => {
    const tx = merge_stack_ptb(deployed_context)({
      ...stack_context,
      target_item_id: id('merge-target'),
      source_item_id: id('merge-source'),
    })
    expect(targets(tx)).toEqual(['extract::merge_locked_stacks_and_relock'])
    const call = find_call(tx, 'extract::merge_locked_stacks_and_relock')
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(7)
  })

  test('client guards reject zero splits and self-merges', () => {
    expect(() =>
      split_stack_ptb(deployed_context)({
        ...stack_context,
        item_id: id('split-source'),
        amount: 0,
      }),
    ).toThrow(/amount must be >= 1/)
    const same_id = id('same-stack')
    expect(() =>
      merge_stack_ptb(deployed_context)({
        ...stack_context,
        target_item_id: same_id,
        source_item_id: same_id,
      }),
    ).toThrow(/cannot merge a stack with itself/)
  })

  test('both composers refuse before targeting an unstamped deployment', () => {
    expect(() =>
      split_stack_ptb(undeployed_context)({
        ...stack_context,
        item_id: id('split-source'),
        amount: 1,
      }),
    ).toThrow(/not deployed/)
    expect(() =>
      merge_stack_ptb(undeployed_context)({
        ...stack_context,
        target_item_id: id('merge-target'),
        source_item_id: id('merge-source'),
      }),
    ).toThrow(/not deployed/)
  })
})

describe('merge_stacks_ptb — the acquisition sweep batch (#1495)', () => {
  const canonical = id('canonical-stack')
  const plan = [
    { ...stack_context, target_item_id: canonical, source_item_id: id('dup-1') },
    { ...stack_context, target_item_id: canonical, source_item_id: id('dup-2') },
  ]

  test('N pairs compose N merge calls in ONE transaction, every one on the same canonical target', () => {
    const tx = merge_stacks_ptb(deployed_context)({ merges: plan })
    expect(targets(tx)).toEqual([
      'extract::merge_locked_stacks_and_relock',
      'extract::merge_locked_stacks_and_relock',
    ])
    // arg #2 is `target_id` (kiosk, cap, target, source, …) — both calls must resolve to the SAME pure input
    const { commands, inputs } = tx.getData()
    const target_bytes = commands.map(
      c => inputs[c.MoveCall.arguments[2].Input].Pure.bytes,
    )
    expect(target_bytes[0]).toBe(target_bytes[1])
    const source_bytes = commands.map(
      c => inputs[c.MoveCall.arguments[3].Input].Pure.bytes,
    )
    expect(source_bytes[0]).not.toBe(source_bytes[1])
    // the canonical target is the id the caller planned, not a source
    const reference = merge_stack_ptb(deployed_context)({
      ...stack_context,
      target_item_id: canonical,
      source_item_id: id('dup-1'),
    }).getData()
    expect(target_bytes[0]).toBe(
      reference.inputs[reference.commands[0].MoveCall.arguments[2].Input].Pure
        .bytes,
    )
  })

  // #1802 — the MULTI-KIOSK batch. A wallet may hold several personal kiosks, so one sweep can carry
  // merges for kiosk-A AND kiosk-B; every call must list ITS OWN pair's kiosk (`0x2::kiosk::list` aborts
  // EItemNotFound / code 11 — "This item belongs to a different kiosk" — the moment a call names a kiosk
  // that does not hold the item). This SEALS the composer half of #1802: the batch is a loop over the
  // singular composer and carries each pair's kiosk through untouched, so a wrong kiosk in a composed call
  // is always the CALLER's join, never this builder's.
  test('a batch spanning two kiosks lists each pair against ITS OWN kiosk', () => {
    const kiosk_a = id('kiosk-a')
    const kiosk_b = id('kiosk-b')
    const tx = merge_stacks_ptb(deployed_context)({
      merges: [
        {
          kiosk_id: kiosk_a,
          personal_kiosk_cap_id: id('cap-a'),
          target_item_id: id('a-target'),
          source_item_id: id('a-source'),
        },
        {
          kiosk_id: kiosk_b,
          personal_kiosk_cap_id: id('cap-b'),
          target_item_id: id('b-target'),
          source_item_id: id('b-source'),
        },
      ],
    })
    const { commands, inputs } = tx.getData()
    // arg #0 is the kiosk object, arg #1 its personal cap — distinct inputs, in the caller's order
    const object_id_of = (command, arg) =>
      inputs[command.MoveCall.arguments[arg].Input].UnresolvedObject.objectId
    expect(commands.map(c => object_id_of(c, 0))).toEqual([kiosk_a, kiosk_b])
    expect(commands.map(c => object_id_of(c, 1))).toEqual([
      id('cap-a'),
      id('cap-b'),
    ])
  })

  test('an empty plan composes an empty transaction (the sweep never signs a no-op)', () => {
    expect(targets(merge_stacks_ptb(deployed_context)({ merges: [] }))).toEqual(
      [],
    )
  })

  test('the batch inherits the singular guards — a self-merge still refuses', () => {
    expect(() =>
      merge_stacks_ptb(deployed_context)({
        merges: [
          {
            ...stack_context,
            target_item_id: canonical,
            source_item_id: canonical,
          },
        ],
      }),
    ).toThrow(/cannot merge a stack with itself/)
  })
})
