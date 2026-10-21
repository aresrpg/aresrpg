// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AllocationStatus } from '@aresrpg/immutable/allocation'

import { initial_allocation, reduce_allocation } from '../../src/allocation/runtime.ts'
import { allocation_view, countdown } from '../../src/allocation/view.ts'
import type { AuthSession } from '../../src/auth.ts'

const wallet = { address: '0x1', identity: 'zklogin' } as AuthSession
const status: AllocationStatus = {
  phase: 'registration',
  submissions_open: true,
  wallets: [{ address: '0x1', label: '' }],
  awards: [{ address: '0x1', tier: 'veteran', source: 'reserved' }],
  user: null,
  submission: null,
}
test('Google invalidation clears cards and rejects an earlier asynchronous result', () => {
  const connected = { ...initial_allocation(), google: wallet, status }
  const pending = reduce_allocation(connected, { type: 'request', task: { kind: 'load' } })
  const invalidated = reduce_allocation(pending, { type: 'invalidated', wallet })
  expect(invalidated.google).toBeNull()
  expect(invalidated.status).toBeNull()
  expect(
    reduce_allocation(invalidated, {
      type: 'result',
      sequence: pending.sequence,
      result: { google: wallet, status, error: null, share_url: null },
    })
  ).toBe(invalidated)
})
test('login and signing are exclusive; logout clears private cards immediately', () => {
  const pending = reduce_allocation(initial_allocation(), { type: 'request', task: { kind: 'google' } })
  expect(reduce_allocation(pending, { type: 'request', task: { kind: 'verify', wallet } })).toBe(pending)
  expect(
    reduce_allocation(
      { ...initial_allocation(), google: wallet, status },
      { type: 'request', task: { kind: 'logout' } }
    ).status
  ).toBeNull()
})
test('server closure and local cutoff both close entries without inventing final results', () => {
  expect(allocation_view(status, Date.parse('2026-10-24T15:00:00Z')).open).toBe(false)
  expect(allocation_view({ ...status, submissions_open: false }, 0).open).toBe(false)
  expect(allocation_view(status, 0).cards[0].pending).toBe(true)
  expect(allocation_view({ ...status, phase: 'final' }, 0).final).toBe(true)
  expect(countdown(Date.parse('2026-10-25T00:00:00Z'))).toEqual([0, 0, 0, 0])
})
test('totals deduplicate verified addresses', () => {
  const view = allocation_view({ ...status, wallets: [...status.wallets, ...status.wallets] }, 0)
  expect(view.spots).toBe(1)
  expect(view.sui).toBe(125)
})
