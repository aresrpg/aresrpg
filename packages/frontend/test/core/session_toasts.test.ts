// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { failure_copy_key } from '../../src/modules/session_toasts.ts'

test('a placement race explains that the cell is unavailable without masking other combat errors', () => {
  // Player-captured resolution error, 2026-09-10.
  const message =
    "[sdk] transaction resolution failed — NOT submitted: Transaction resolution failed: MoveAbort in 2nd command, abort code: 1709, in '0xaf290bf4776c635a444a16006cd60b1160a22c4b249151f61a3efd04a6856a53::combat::place' (instruction 76)"
  expect(failure_copy_key(message)).toBe('fight_placement_unavailable_toast')
  expect(failure_copy_key(message.replace('::combat::place', '::combat::ready'))).toBeNull()
  expect(failure_copy_key(message.replace('1709', '1708'))).toBeNull()
})

test('an unprovable world move has one human-readable failure key', () => {
  expect(
    failure_copy_key(
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 305, in '0xgame::world::prove_move' (instruction 57)"
    )
  ).toBe('movement_sync_toast')
  expect(failure_copy_key('abort code: 305 in 0xgame::another_module')).toBeNull()
})

test('a stale fight path names the resync instead of exposing abort 1725', () => {
  expect(failure_copy_key("MoveAbort abort code: 1725 in '0xgame::fight::walk_path'")).toBe('fight_path_changed_toast')
})

test('a globally occupied party character never exposes abort 2002', () => {
  expect(
    failure_copy_key(
      "Transaction resolution failed: MoveAbort in 2nd command, abort code: 2002, in '0xgame::party::af'"
    )
  ).toBe('party_member_unavailable_toast')
  expect(failure_copy_key("MoveAbort abort code: 2002 in '0xgame::party::accept'")).toBeNull()
})

test('a crank race reports that another player already forced the turn', () => {
  expect(failure_copy_key("MoveAbort abort code: 1724 in '0xgame::fight::crank'")).toBe(
    'fight_turn_already_forced_toast'
  )
  expect(failure_copy_key("MoveAbort abort code: 1724 in '0xgame::fight::end_turn'")).toBeNull()
})
