// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'
import { owned_placement_readiness } from '../../src/modules/fight_identity.ts'
import { fight_checkpoint_phase_rank, fight_state_regresses } from '../../src/modules/fight_observer.ts'

const settings = Object.freeze({
  quality: 'medium' as const,
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
})

test('Ready stays latched after receipt completion and unlocks only on refusal', () => {
  const base = initial_app_state(settings)
  const submitted = reduce_app_state(base, {
    type: 'fight/input',
    fight: '0xf',
    origin: 'local',
    input: { type: 'ready', fighter: 0n },
  })
  const pending = reduce_app_state(submitted, { type: 'fight/transaction_pending', fight: '0xf', pending: true })
  const certified = reduce_app_state(pending, { type: 'fight/transaction_pending', fight: '0xf', pending: false })
  expect(certified.fight.environments['0xf']?.ready_submitted_seats).toEqual([0])

  const refused = reduce_app_state(certified, {
    type: 'fight/restored',
    checkpoint: { contract: { id: '0xf' } } as never,
  })
  expect(refused.fight.environments['0xf']?.ready_submitted_seats).toEqual([])
})

test('ready-all keeps confirmed transaction progress when a later seat fails', () => {
  const base = initial_app_state(settings)
  const progressed = reduce_app_state(base, {
    type: 'fight/ready_all_progress',
    fight: '0xf',
    completed: 1,
    total: 3,
    status: 'running',
    fighter: 2n,
  })
  const restored = reduce_app_state(progressed, {
    type: 'fight/restored',
    checkpoint: { contract: { id: '0xf' } } as never,
  })
  const failed = reduce_app_state(restored, {
    type: 'fight/ready_all_progress',
    fight: '0xf',
    completed: 1,
    total: 3,
    status: 'failed',
  })

  expect(failed.fight.environments['0xf']?.ready_submitted_seats).toEqual([2])
  expect(failed.fight.environments['0xf']?.ready_all_progress).toEqual({
    completed: 1,
    total: 3,
    status: 'failed',
  })
})

test('ready all selects only living owned roster seats that remain unready', () => {
  const fighter = (character: string, owner: string, ready: boolean) => ({
    kind: { type: 'player', character, owner },
    ready,
    dead: false,
    settled: false,
  })
  const checkpoint = {
    contract: {
      fighters: [
        fighter('0xa', '0xme', false),
        fighter('0xb', '0xme', false),
        fighter('0xc', '0xme', true),
        fighter('0xd', '0xother', false),
      ],
    },
  }

  expect(owned_placement_readiness(checkpoint as never, '0xme', new Set(['0xa', '0xb', '0xc']), [1])).toEqual({
    owned_count: 3,
    unready_seats: [0n],
  })
})

test('fight phase is monotonic across light lifecycle packets and full snapshots', () => {
  expect(fight_checkpoint_phase_rank({ round: 0, ended: false })).toBe(0)
  expect(fight_checkpoint_phase_rank({ round: '1', ended: false })).toBe(1)
  expect(fight_checkpoint_phase_rank({ round: 1, ended: true })).toBe(2)
  expect(fight_state_regresses(1, { round: 0, ended: false })).toBeTrue()
  expect(fight_state_regresses(2, { round: 1, ended: false })).toBeTrue()
  expect(fight_state_regresses(1, { round: 1, ended: false })).toBeFalse()
})
