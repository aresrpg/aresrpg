// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  merge_stack_ptb,
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
    expect(targets(tx)).toEqual([
      'header::aresrpg',
      'extract::split_locked_stack',
    ])
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
    expect(targets(tx)).toEqual([
      'header::aresrpg',
      'extract::merge_locked_stacks_and_relock',
    ])
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
