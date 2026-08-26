// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { failure_copy_key } from '../../src/modules/session_toasts.ts'

test('an unprovable world move has one human-readable failure key', () => {
  expect(
    failure_copy_key(
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 305, in '0xgame::world::prove_move' (instruction 57)"
    )
  ).toBe('movement_sync_toast')
  expect(failure_copy_key('abort code: 305 in 0xgame::another_module')).toBeNull()
})
