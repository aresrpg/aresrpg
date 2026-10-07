// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { initial_gift_state, reduce_gift, type GiftState, type GiftWallet } from '../../src/airdrop/gift_state.ts'
import { is_gift_entry, gift_link_from_url } from '../../src/airdrop/gift_intent.ts'
import { carousel_crossings, carousel_plan, carousel_progress, BOX_SPIN_MS } from '../../src/characters/box_carousel.ts'

const wallet = { address: 'alice', identity: 'zklogin' } as GiftWallet
const proof = { giftcard: `0x${'1'.repeat(64)}` }
const ready = (): GiftState => ({
  ...initial_gift_state(),
  ready: true,
  wallet,
})
const checked = (state: GiftState, stage: 'voucher' | 'crate' | 'reward') => {
  const pending = reduce_gift(state, { type: 'request', kind: 'check' })
  return reduce_gift(pending, {
    type: 'completed',
    task: pending.task!.id,
    result: { kind: 'checked', status: { stage, proof } },
  })
}

test('printed gift routes and fragment-bearing claim routes bypass the game entry', () => {
  expect(is_gift_entry('/gift', '#$unchanged-card-key')).toBe(true)
  expect(is_gift_entry('/claim', '#$unchanged-card-key')).toBe(true)
  expect(is_gift_entry('/claim', '', '/claim')).toBe(true)
  expect(is_gift_entry('/claim', '')).toBe(false)
  expect(is_gift_entry('/', '#$secret', '/claim')).toBe(false)
  expect(gift_link_from_url('https://aresrpg.world/gift#$unchanged-card-key')).toBe(
    'https://aresrpg.world/gift#$unchanged-card-key'
  )
})

test('a failed automatic redemption stops until an explicit retry', () => {
  const started = checked(ready(), 'voucher')
  expect(started.task?.kind).toBe('redeem')
  const failed = reduce_gift(started, { type: 'failed', task: started.task!.id, error: 'sponsor_unavailable' })
  const refreshed = checked(failed, 'voucher')
  expect(refreshed.task).toBeNull()
  expect(reduce_gift(refreshed, { type: 'request', kind: 'redeem' }).task?.kind).toBe('redeem')
})

test('restoring a session checks status without submitting transactions', () => {
  const boot = reduce_gift(initial_gift_state(), { type: 'start' })
  const restored = reduce_gift(boot, {
    type: 'completed',
    task: boot.task!.id,
    result: { kind: 'connected', wallet, advance: false },
  })
  for (const stage of ['available', 'voucher', 'reward'] as const) {
    const state = reduce_gift(restored, {
      type: 'completed',
      task: restored.task!.id,
      result: { kind: 'checked', status: { stage, proof } },
    })
    expect(state.task).toBeNull()
  }
})

test('duplicate clicks cannot open twice and repeated status cannot restart the reveal', () => {
  const opening = reduce_gift(checked(ready(), 'crate'), { type: 'request', kind: 'open' })
  expect(reduce_gift(opening, { type: 'request', kind: 'open' })).toBe(opening)
  const completed = reduce_gift(opening, {
    type: 'completed',
    task: opening.task!.id,
    result: { kind: 'executed', proof: { ...proof, open: 'confirmed-open' } },
  })
  expect(completed.status?.proof?.open).toBe('confirmed-open')
  const revealed = reduce_gift(completed, {
    type: 'completed',
    task: completed.task!.id,
    result: { kind: 'checked', status: { stage: 'reward', proof } },
  })
  expect(revealed.celebrate).toBe(true)
  expect(revealed.task?.kind).toBe('collect')
  const shown = reduce_gift({ ...revealed, task: null }, { type: 'celebrated' })
  expect(checked(shown, 'reward').celebrate).toBe(false)
})

test('an expired completion cannot overwrite a disconnected account', () => {
  const opening = reduce_gift(checked(ready(), 'crate'), { type: 'request', kind: 'open' })
  const stopped = reduce_gift(opening, { type: 'invalidated', wallet })
  expect(
    reduce_gift(stopped, {
      type: 'completed',
      task: opening.task!.id,
      result: { kind: 'executed' },
    })
  ).toBe(stopped)
})

test('every carousel result lands on its confirmed item and each crossing gets a matching sound time', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f']
  for (const reward of pool) {
    const plan = carousel_plan(pool, reward)
    expect(plan.items[plan.target]).toBe(reward)
    expect(new Set(plan.items)).toEqual(new Set(pool))
    const crossings = carousel_crossings(plan.target)
    expect(crossings).toHaveLength(plan.target)
    crossings.forEach((time, index) =>
      expect(carousel_progress(time / BOX_SPIN_MS) * plan.target).toBeCloseTo(index + 0.5, 7)
    )
    expect(crossings.some((time, index) => index > 0 && time - crossings[index - 1]! < 240)).toBe(true)
  }
})

test('refreshing the same wallet session retains the selected card, while changing accounts clears it', () => {
  const state = reduce_gift(checked(ready(), 'crate'), { type: 'request', kind: 'check' })
  for (const address of ['alice', 'bob']) {
    const next = reduce_gift(state, {
      type: 'completed',
      task: state.task!.id,
      result: { kind: 'connected', wallet: { ...wallet, address }, advance: true },
    })
    expect(next.status).toEqual(address === 'alice' ? state.status : null)
  }
})
