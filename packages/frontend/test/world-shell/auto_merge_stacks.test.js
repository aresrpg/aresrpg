// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 boot sweep — the orchestrator's four laws: ONE submit per session, never mid-fight, the receipt
// (not the plan) folds the bag, and an EXECUTED failure is never retried. Pure dependency injection: the
// sweep takes its fight predicate, submit door, fold door and session latch — no store, no chain, no mocks.

import { describe, expect, test } from 'bun:test'
import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import { sweep_duplicate_stacks } from '../../src/world-shell/auto_merge_stacks.js'

const bag = () => [
  { id: '0xa', template_id: 't', kiosk_id: '0xk', amount: 1, stackable: true },
  { id: '0xb', template_id: 't', kiosk_id: '0xk', amount: 1, stackable: true },
  { id: '0xc', template_id: 't', kiosk_id: '0xk', amount: 1, stackable: true },
]

const harness = (over = {}) => {
  const submits = []
  const folds = []
  return {
    submits,
    folds,
    deps: {
      items: bag(),
      fight_active: () => false,
      submit: async (merges) => {
        submits.push(merges)
        return {
          events: [
            { type: '0xp::item::ItemMerged', parsedJson: { into: '0xa', from: '0xb', total: 2 } },
            { type: '0xp::item::ItemMerged', parsedJson: { into: '0xa', from: '0xc', total: 3 } },
          ],
        }
      },
      fold: (rows) => folds.push(rows),
      latch: { fired: false },
      ...over,
    },
  }
}

describe('sweep_duplicate_stacks', () => {
  test('three same-template singletons compose ONE submit onto the canonical, folded from the receipt', async () => {
    const { deps, submits, folds } = harness()
    const result = await sweep_duplicate_stacks(deps)
    expect(result.swept).toBe(true)
    expect(submits).toHaveLength(1)
    expect(submits[0].map((m) => m.target_item_id)).toEqual(['0xa', '0xa'])
    expect(submits[0].map((m) => m.source_item_id)).toEqual(['0xb', '0xc'])
    expect(folds).toEqual([
      [
        { into: '0xa', from: '0xb', total: 2 },
        { into: '0xa', from: '0xc', total: 3 },
      ],
    ])
  })

  test('at most ONCE per session — a second call submits nothing', async () => {
    const { deps, submits } = harness()
    await sweep_duplicate_stacks(deps)
    const second = await sweep_duplicate_stacks(deps)
    expect(second).toEqual({ swept: false, reason: 'already-swept' })
    expect(submits).toHaveLength(1)
  })

  test('a live fight blocks the submit and leaves the sweep armed for after it', async () => {
    const { deps, submits } = harness({ fight_active: () => true })
    const result = await sweep_duplicate_stacks(deps)
    expect(result).toEqual({ swept: false, reason: 'fight-active' })
    expect(submits).toHaveLength(0)
    expect(deps.latch.fired).toBe(false)
  })

  test('nothing to merge: no submit, no fold, still armed', async () => {
    const { deps, submits } = harness({ items: [bag()[0]] })
    expect(await sweep_duplicate_stacks(deps)).toEqual({ swept: false, reason: 'nothing-to-merge' })
    expect(submits).toHaveLength(0)
    expect(deps.latch.fired).toBe(false)
  })

  test('an EXECUTED failure (a digest exists = gas burned) is NEVER retried', async () => {
    const executed = Object.assign(new Error('MoveAbort'), { executed_digest: '0xdead' })
    const { deps, submits, folds } = harness({
      submit: async (merges) => {
        submits.push(merges)
        throw executed
      },
    })
    const first = await sweep_duplicate_stacks(deps)
    expect(first.swept).toBe(true)
    expect(first.error).toBe(executed)
    expect(folds).toEqual([]) // no optimistic bag rewrite on a failure
    await sweep_duplicate_stacks(deps)
    expect(submits).toHaveLength(1)
  })

  test('a sponsor/pre-flight refusal degrades silently — the caller never sees a throw', async () => {
    const { deps } = harness({
      submit: async () => {
        throw new Error('sponsor daily cap reached')
      },
    })
    const result = await sweep_duplicate_stacks(deps)
    expect(result.swept).toBe(true)
    expect(result.error).toBeInstanceOf(Error)
  })

  test('post-sweep live custody refresh leaves only the surviving object id in inventory rows', async () => {
    let state = {
      items: bag(),
      characters: [],
      settled_item_floor: {},
      minted_character_floor: {},
      xp_floor: {},
      deleted_ids: {},
    }
    const live = [{ ...bag()[0], amount: 3 }]

    await sweep_duplicate_stacks({
      items: state.items,
      fight_active: () => false,
      submit: async () => ({
        events: [
          {
            type: '0xp::extract::StacksMerged',
            parsedJson: { target: '0xa', source: '0xb', total: 2 },
          },
          {
            type: '0xp::extract::StacksMerged',
            parsedJson: { target: '0xa', source: '0xc', total: 3 },
          },
        ],
      }),
      fold: (merges) => {
        state = reduce_sui_data(state, {
          kind: 'receipt_patch',
          op: 'merge_stacks',
          merges,
        })
      },
      refresh: async () => {
        state = reduce_sui_data(state, { kind: 'snapshot', items: live })
      },
      latch: { fired: false },
    })

    expect(state.items.map((item) => item.id)).toEqual(['0xa'])
    expect(state.items[0].amount).toBe(3)
    expect(state.items.some((item) => item.id === '0xb' || item.id === '0xc')).toBe(false)
  })
})
