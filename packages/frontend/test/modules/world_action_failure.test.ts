// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { world_action_failure } from '../../src/modules/world_action_failure.ts'

const abort = "MoveAbort, abort code: 305, in '0xgame::world::prove_move'"

test('only an unsigned movement timing refusal gets a retry deadline', () => {
  expect(
    world_action_failure(new Error(`[sdk] transaction resolution failed — NOT submitted: ${abort}`), 1_000)
  ).toEqual({ retry_at_ms: 1_500 })
  expect(
    world_action_failure(new Error(`[sdk] dry run failed — transaction NOT submitted (zero gas): ${abort}`), 1_000)
  ).toEqual({ retry_at_ms: 1_500 })
})

test('executed, uncertain, unrelated, and unclassified failures cannot retry', () => {
  for (const message of [
    `[sdk] transaction digest failed on-chain: ${abort}`,
    `[sdk] transaction outcome unknown: ${abort}`,
    `[sdk] transaction resolution failed — NOT submitted: MoveAbort, abort code: 3050, in '0xgame::world::prove_move'`,
    `[sdk] transaction resolution failed — NOT submitted: MoveAbort, abort code: 305, in '0xgame::other::prove_move'`,
    'too fast',
  ])
    expect(world_action_failure(new Error(message), 1_000)).toEqual({})
  expect(world_action_failure(`[sdk] transaction resolution failed — NOT submitted: ${abort}`, 1_000)).toEqual({})
})
