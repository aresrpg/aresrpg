// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 boot sweep — the orchestrator's four laws: ONE submit per session, never mid-fight, the receipt
// (not the plan) folds the bag, and an EXECUTED failure is never retried. Pure dependency injection: the
// sweep takes its fight predicate, submit door, fold door and session latch — no store, no chain, no mocks.

import { describe, expect, test } from 'bun:test'
import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import { merge_plan_signature, sweep_duplicate_stacks } from '../../src/world-shell/auto_merge_stacks.js'

/** The injected cross-load refusal memo, in memory (localStorage is the real edge's business). */
const memo = (seen = []) => ({
  seen,
  has: (signature) => seen.includes(signature),
  remember: (signature) => void seen.push(signature),
})

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
      // #1802 — chain custody is what gets SIGNED. The default harness has the mirror and the chain agreeing.
      custody: async () => bag(),
      refusals: memo(),
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

  // ── #1802: the MULTI-KIOSK wrong-kiosk abort ────────────────────────────────────────────────────────
  // A veteran wallet holds several personal kiosks. The display bag is the indexer mirror, whose item→kiosk
  // edge can lag chain custody (an item that moved between the wallet's OWN kiosks keeps its old kiosk_id
  // until the mirror catches up). Composing on that stale edge lists an item against a kiosk that does not
  // hold it — `0x2::kiosk::list` abort 11 / EItemNotFound, "This item belongs to a different kiosk" — on
  // EVERY load. Object ids are transaction inputs, never display cache (read_staking.js's own law), so the
  // plan that gets SIGNED is derived from the live kiosk-union walk.
  describe('the signed plan comes from chain custody, never the display mirror', () => {
    // Mirror: all four stacks claim kiosk-A. Chain: 0xc/0xd actually live in kiosk-B.
    const mirror = [
      { id: '0xa', template_id: 't', kiosk_id: '0xk_a', amount: 1, stackable: true },
      { id: '0xb', template_id: 't', kiosk_id: '0xk_a', amount: 1, stackable: true },
      { id: '0xc', template_id: 't', kiosk_id: '0xk_a', amount: 1, stackable: true },
      { id: '0xd', template_id: 't', kiosk_id: '0xk_a', amount: 1, stackable: true },
    ]
    const live = [
      { id: '0xa', template_id: 't', kiosk_id: '0xk_a', amount: 1, stackable: true },
      { id: '0xb', template_id: 't', kiosk_id: '0xk_a', amount: 1, stackable: true },
      { id: '0xc', template_id: 't', kiosk_id: '0xk_b', amount: 1, stackable: true },
      { id: '0xd', template_id: 't', kiosk_id: '0xk_b', amount: 1, stackable: true },
    ]

    test('every merge names the kiosk that ACTUALLY holds its pair (#1802)', async () => {
      const { deps, submits } = harness({ items: mirror, custody: async () => live })
      await sweep_duplicate_stacks(deps)
      expect(submits).toHaveLength(1)
      expect(submits[0]).toEqual([
        { kiosk_id: '0xk_a', target_item_id: '0xa', source_item_id: '0xb' },
        { kiosk_id: '0xk_b', target_item_id: '0xc', source_item_id: '0xd' },
      ])
    })

    test('a stale mirror row never drags a sibling-kiosk stack into another kiosk s merge', async () => {
      const { deps, submits } = harness({
        items: mirror,
        // chain: 0xa/0xb in kiosk-A, the lone 0xc in kiosk-B — one merge, and 0xc is not part of it
        custody: async () => live.slice(0, 3),
      })
      await sweep_duplicate_stacks(deps)
      expect(submits[0]).toEqual([{ kiosk_id: '0xk_a', target_item_id: '0xa', source_item_id: '0xb' }])
    })

    test('chain custody says there is nothing to merge: the mirror never signs on its own', async () => {
      const { deps, submits } = harness({ items: mirror, custody: async () => [live[0], live[2]] })
      expect(await sweep_duplicate_stacks(deps)).toEqual({ swept: false, reason: 'nothing-to-merge' })
      expect(submits).toHaveLength(0)
    })

    test('a failed custody read submits NOTHING — a merge is never signed on an unverified join', async () => {
      const { deps, submits } = harness({
        items: mirror,
        custody: async () => {
          throw new Error('kiosk union walk timed out')
        },
      })
      const result = await sweep_duplicate_stacks(deps)
      expect(submits).toHaveLength(0)
      expect(result.error).toBeInstanceOf(Error)
    })

    test('a clean mirror never pays for the custody walk (zero duplicates = zero reads)', async () => {
      let reads = 0
      const { deps } = harness({
        items: [mirror[0]],
        custody: async () => {
          reads += 1
          return live
        },
      })
      expect(await sweep_duplicate_stacks(deps)).toEqual({ swept: false, reason: 'nothing-to-merge' })
      expect(reads).toBe(0)
    })
  })

  // ── #1802 rider: a refused plan is never blindly re-signed on the next load ─────────────────────────
  // The session latch dies with the tab, so before this the sweep re-submitted the SAME plan on EVERY app
  // load — a pre-flight refusal looped forever, and an EXECUTED failure re-burned gas each load. The memo
  // is the only cross-load state: the exact plan that failed is not signed again; ANY change to it is.
  describe('a failed plan is remembered across loads', () => {
    const refusing = (over = {}) => {
      const submits = []
      const { deps } = harness({
        submit: async (merges) => {
          submits.push(merges)
          throw new Error('SimulationError: This item belongs to a different kiosk')
        },
        ...over,
      })
      return { deps, submits }
    }

    test('the same plan is submitted ONCE, however many app loads follow', async () => {
      const refusals = memo()
      const first = refusing({ refusals })
      await sweep_duplicate_stacks(first.deps)
      expect(first.submits).toHaveLength(1)

      // a fresh app load: new module latch, same bag, same refusal memo
      const second = refusing({ refusals })
      expect(await sweep_duplicate_stacks(second.deps)).toEqual({ swept: false, reason: 'already-refused' })
      expect(second.submits).toHaveLength(0)
    })

    test('a CHANGED plan is always tried — the memo pins one plan, never the sweep', async () => {
      const refusals = memo()
      await sweep_duplicate_stacks(refusing({ refusals }).deps)
      const grown = [...bag(), { id: '0xd', template_id: 't', kiosk_id: '0xk', amount: 1, stackable: true }]
      const next = harness({ refusals, items: grown, custody: async () => grown })
      const result = await sweep_duplicate_stacks(next.deps)
      expect(result.swept).toBe(true)
      expect(next.submits).toHaveLength(1)
    })

    test('an EXECUTED failure is remembered too — a digest burned gas once, never once per load', async () => {
      const refusals = memo()
      const executed = Object.assign(new Error('MoveAbort'), { executed_digest: '0xdead' })
      const { deps } = harness({
        refusals,
        submit: async () => {
          throw executed
        },
      })
      await sweep_duplicate_stacks(deps)
      expect(refusals.seen).toHaveLength(1)
    })

    test('a SUCCESSFUL sweep is never memoized — the next bag gets its own attempt', async () => {
      const refusals = memo()
      await sweep_duplicate_stacks(harness({ refusals }).deps)
      expect(refusals.seen).toEqual([])
    })

    test('the signature pins the kiosk, so the same pair in another kiosk is a different plan', () => {
      const pair = { target_item_id: '0xa', source_item_id: '0xb' }
      expect(merge_plan_signature([{ ...pair, kiosk_id: '0xk_a' }])).not.toBe(
        merge_plan_signature([{ ...pair, kiosk_id: '0xk_b' }])
      )
    })
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
      custody: async () => bag(),
      refusals: memo(),
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
