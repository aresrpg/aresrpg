// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { claim_is_settleable } from '../../src/modules/claims.ts'

// REPORTED 2026-08-22: opening a pet box raised "The rolled item is not in the authored
// catalog" and left the reveal button spinning on Collecting… forever. The catalog was fine —
// `inventory/box_opened` folds the claim from the receipt as { id, kind } alone, because the
// open receipt names the CLAIM and not what it rolled. The silent claimer settled it anyway,
// read an absent template, and threw. The roll belongs to the projection's streamed row.
test('a box claim is settleable only once the projection has told us what it rolled', () => {
  expect(claim_is_settleable({ id: '0x1', kind: 'box' })).toBeFalse()
  expect(claim_is_settleable({ id: '0x1', kind: 'box', rolled_template: '' })).toBeFalse()
  expect(claim_is_settleable({ id: '0x1', kind: 'box', rolled_template: '0xabc' })).toBeTrue()
})

// a crush yield carries no roll — its contents are the rune set, known from the catalog alone
test('a crush claim never waits on a projected roll', () => {
  expect(claim_is_settleable({ id: '0x2', kind: 'crush' })).toBeTrue()
  expect(claim_is_settleable({ id: '0x2', kind: 'crush', amount: 3 })).toBeTrue()
})
