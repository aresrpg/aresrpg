// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

test('runeforge history is newest-first, per gear, deduplicated, and session-bounded', () => {
  const base = initial_app_state(settings)
  const input = {
    type: 'runeforge/scribed' as const,
    gear_before: {
      id: '0xgear',
      name: 'Hat',
      item_type: 'hat',
      category: 'hat',
      level: 1,
      amount: 1,
      kiosk: '0xkiosk',
      puits: '2',
    },
    rune_before: {
      id: '0xrune',
      name: 'Rune',
      item_type: 'rune_vitality_ba',
      category: 'rune',
      level: 1,
      amount: 2,
      kiosk: '0xkiosk',
    },
    outcome: {
      digest: '0xdigest',
      stat: 0,
      outcome: 0,
      applied_value: 3,
      lost_stat: 255,
      lost_amount: 0,
      new_puits: 2,
    },
  }
  const first = reduce_app_state(base, input)
  const duplicate = reduce_app_state(first, input)
  const other = reduce_app_state(duplicate, {
    ...input,
    gear_before: { ...input.gear_before, id: '0xother' },
    outcome: { ...input.outcome, digest: '0xother' },
  })

  expect(first.runeforge.history_by_gear['0xgear']).toEqual([
    {
      digest: '0xdigest',
      rune_item_type: 'rune_vitality_ba',
      outcome: 'critical_success',
      applied_stat: 'vitality',
      applied_value: 3,
      lost_stat: null,
      lost_amount: 0,
      puits_before: 2,
      puits_after: 2,
    },
  ])
  expect(duplicate.runeforge).toBe(first.runeforge)
  expect(other.runeforge.history_by_gear['0xgear']).toHaveLength(1)
  expect(other.runeforge.history_by_gear['0xother']).toHaveLength(1)
  expect(reduce_app_state(other, { type: 'auth/disconnected' }).runeforge.history_by_gear).toEqual({})
})
