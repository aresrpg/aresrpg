// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import en from '../../src/i18n/locales/en.yaml'
import { copy_text } from '../../src/i18n/copy.ts'
import { initial_tournament_state } from '../../src/modules/tournament.ts'
import {
  action_label,
  operation_status,
  countdown,
  team_initial,
  tournament_name,
} from '../../src/tournament/presentation.ts'

test('registration refusal tells the player the tournament maximum level', () => {
  const t = copy_text(en.tournament_page)
  expect(action_label({ kind: 'status', reason: 'level' }, t, 10)).toBe('The maximum level for this tournament is 10.')
  expect(action_label({ kind: 'status', reason: 'level' }, t, 50)).toBe('The maximum level for this tournament is 50.')
  expect(action_label({ kind: 'status', reason: 'clock' }, t, null)).toBe(t('reason_clock'))
})

test('tournament labels expose formatting controls without rejecting ordinary Unicode names', () => {
  expect(tournament_name('Owls\u202e\u2069\n')).toBe('Owls���')
  expect(tournament_name('\u200b\u200d\ufe0f ')).toBe('—')
  expect(tournament_name('夜の梟 👩‍👩‍👧‍👦')).toBe('夜の梟 👩‍👩‍👧‍👦')
  expect(tournament_name('البوم')).toBe('البوم')
  expect(tournament_name('<img src=x> $& {{team}}')).toBe('<img src=x> $& {{team}}')
  expect(team_initial('\u202eOwls')).toBe('�')
})

test('submission display never turns a superseded result or missing receipt into success', () => {
  const state = initial_tournament_state()
  expect(operation_status(state, 'write', false).phase).toBe('idle')
  expect(operation_status({ ...state, pending: 'write' }, 'write', true).phase).toBe('pending')
  expect(operation_status(state, 'write', true).phase).toBe('submitted')
  expect(operation_status({ ...state, outcome: { key: 'other', reason: null } }, 'write', true).phase).toBe('submitted')
  expect(operation_status({ ...state, outcome: { key: 'write', reason: null } }, 'write', true).phase).toBe('confirmed')
  expect(operation_status({ ...state, outcome: { key: 'write', reason: 'gas' } }, 'write', true)).toEqual({
    phase: 'failed',
    reason: 'gas',
  })
})

test('countdowns distinguish unknown clocks and clamp elapsed windows without negative time', () => {
  expect(countdown(60_000, null)).toBe('—')
  expect(countdown(60_000, 61_000)).toBe('0:00')
  expect(countdown(60_000, 49_001)).toBe('0:11')
  expect(countdown(8_040_000, 0)).toBe('2:14:00')
})
