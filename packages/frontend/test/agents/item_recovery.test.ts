// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { item_return_group } from '../../src/agents/inventory_transfer.ts'
import { item_claim_attempts } from '../../src/agents/item_recovery.ts'

const item = {
  agent_address: 'source',
  recipient: 'recipient',
  seller_kiosk: 'kiosk',
  item_id: 'item',
  purchase_cap: 'cap',
}
const fixture = () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  return { storage, attempts: item_claim_attempts(storage, 'owner') }
}
test('one attempted cap cannot automatically retry under another intent or after remount/reload', () => {
  const f = fixture()
  f.attempts.begin([item], false)
  expect(f.attempts.status(item)).toBe('attempted')
  const restored = item_claim_attempts(f.storage, 'owner')
  expect(() => restored.begin([item], true)).toThrow('reconciliation')
  restored.begin([item], false)
  expect(() => restored.begin([item], true)).toThrow('reconciliation')
})
test('attempt fences bind the exact cap, both parties and owner; completion cannot clear unrelated attempts', () => {
  const f = fixture(),
    other = { ...item, purchase_cap: 'other' }
  f.attempts.begin([item, other], false)
  for (const changed of [
    { ...item, agent_address: 'foreign' },
    { ...item, recipient: 'foreign' },
  ])
    expect(f.attempts.status(changed)).toBeUndefined()
  expect(item_claim_attempts(f.storage, 'another-owner').status(item)).toBeUndefined()
  const before = f.attempts.completed()
  f.attempts.complete([item])
  f.attempts.retire(before, [], ['source', 'recipient'])
  expect(f.attempts.status(item)).toBe('complete')
  const completed = f.attempts.completed()
  f.attempts.retire(completed, [item], ['source', 'recipient'])
  expect(() => f.attempts.begin([item], false)).toThrow('reconciliation')
  f.attempts.retire(completed, [], ['source', 'recipient'])
  expect(f.attempts.status(item)).toBeUndefined()
  expect(f.attempts.status(other)).toBe('attempted')
})
test('unavailable or malformed attempt storage refuses automatic work before a signature can start', () => {
  const f = fixture()
  f.storage.getItem = () => '{'
  expect(() => f.attempts.begin([item], true)).toThrow()
  f.storage.getItem = () => null
  f.storage.setItem = () => {
    throw new Error('storage denied')
  }
  expect(() => f.attempts.begin([item], true)).toThrow('storage denied')
})

test('recovery retains one receipt and direction rather than claiming the entire pending route', () => {
  const selected = { ...item, offer_digest: 'drag' }
  const companion = { ...selected, item_id: 'second', purchase_cap: 'second' }
  const unrelated = { ...selected, offer_digest: 'other', purchase_cap: 'other' }
  const foreign = { ...selected, recipient: 'foreign', purchase_cap: 'foreign' }
  expect(item_return_group([selected, companion, unrelated, foreign], selected)).toEqual([selected, companion])
  expect(item_return_group([item, { ...item, purchase_cap: 'unknown-origin' }], item)).toEqual([item])
})
