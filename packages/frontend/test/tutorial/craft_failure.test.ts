// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { observe_craft_failure } from '../../src/tutorial/CraftFailureNotice.tsx'

test('a fresh failure is retained through later success and duplicate receipts', () => {
  const initial = { digest: 'old', pending: false, completed: false }
  expect(observe_craft_failure(initial, { digest: 'old', failed: true, completed: false })).toBe(initial)
  const failed = observe_craft_failure(initial, { digest: 'new', failed: true, completed: false })
  expect(failed.pending).toBeTrue()
  expect(observe_craft_failure(failed, { digest: 'success', failed: false, completed: false }).pending).toBeTrue()
})

test('acknowledgement and Reset forget old failures until another attempt fails', () => {
  const failed = { digest: 'first', pending: true, completed: false }
  const acknowledged = observe_craft_failure(failed, { digest: 'first', failed: true, completed: true })
  expect(acknowledged.pending).toBeFalse()
  const reset = observe_craft_failure(acknowledged, { digest: 'first', failed: true, completed: false })
  expect(reset.pending).toBeFalse()
  expect(observe_craft_failure(reset, { digest: 'second', failed: true, completed: false }).pending).toBeTrue()
})
