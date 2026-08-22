// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { turn_too_soon_refusal } from '../../src/modules/fight_chain.ts'
import { terminal_remote_draft_needs_commit } from '../../src/modules/fight_lifecycle.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

test('a locally lethal remote draft needs one canonical End Turn commit', () => {
  const fight = {
    mode: 'remote' as const,
    checkpoint: { contract: { id: '0xf', ended: true } } as never,
    presentations: [],
    canonical_ended: false,
    end_turn_queued: false,
    end_turn_submitted: false,
    transaction_pending: false,
  }
  expect(terminal_remote_draft_needs_commit(fight)).toBeTrue()
  expect(terminal_remote_draft_needs_commit({ ...fight, canonical_ended: true })).toBeFalse()
})

test('a zero-gas too-soon refusal requeues, while an executed failure never retries', () => {
  expect(
    turn_too_soon_refusal(
      new Error('[sdk] dry run failed — transaction NOT submitted (zero gas): MoveAbort, abort code: 1724')
    )
  ).toBeTrue()
  expect(turn_too_soon_refusal(new Error('[sdk] transaction 0xdigest failed on-chain: abort code: 1724'))).toBeFalse()

  let state = initial_app_state(settings)
  state = { ...state, fight: { ...state.fight, checkpoint: { contract: { id: '0xf' } } as never } }
  state = reduce_app_state(state, {
    type: 'fight/input',
    origin: 'local',
    input: { type: 'end_turn', fighter: 0n, observed_ms: 0n },
  })
  state = reduce_app_state(state, { type: 'fight/end_turn_queued', fight: '0xf', queued: true })
  expect(state.fight.end_turn_submitted).toBeFalse()
  expect(state.fight.end_turn_queued).toBeTrue()
})
