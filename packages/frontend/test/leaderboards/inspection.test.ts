// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { PlayerProfile } from '@aresrpg/protocol'

import {
  initial_inspection,
  reduce_inspection,
  fold_inspection,
  inspection_request,
} from '../../src/leaderboards/inspection.ts'
import leaderboards, {
  initial_leaderboards_state,
  inspection_subscription,
  reduce_leaderboards,
} from '../../src/modules/leaderboards.ts'
import type { AppState } from '../../src/store.ts'

const address = `0x${'a'.repeat(64)}`
const character_id = `0x${'b'.repeat(64)}`
const profile: PlayerProfile = {
  character_count: 41,
  characters: [{ id: character_id, name: 'Hero', classe: 'senshi', level: 40 }],
  next: character_id,
  jobs: [{ job: 'MINER', level: 100 }],
}
const opened = () =>
  reduce_inspection(initial_inspection(), { type: 'leaderboards/inspect', address, name: 'hero.sui' })
const loaded = () =>
  fold_inspection(opened(), { type: 'packet/inspection_result', id: 1, result: { kind: 'profile', profile } })

test('closing and reopening reject old data and errors, including from the same address', () => {
  const closed = reduce_inspection(opened(), { type: 'leaderboards/inspect_close' })
  expect(inspection_request(closed).query).toBeNull()
  const reopened = reduce_inspection(closed, { type: 'leaderboards/inspect', address, name: null })
  expect(
    fold_inspection(reopened, { type: 'packet/inspection_result', id: 1, result: { kind: 'profile', profile } })
  ).toBe(reopened)
  expect(fold_inspection(reopened, { type: 'packet/inspection_error', id: 1 })).toBe(reopened)
  expect(
    fold_inspection(closed, { type: 'packet/inspection_result', id: 1, result: { kind: 'profile', profile } })
  ).toBe(closed)
})

test('equipment selection is restricted to the displayed roster and distinguishes bare from transferred', () => {
  const state = loaded()
  expect(reduce_inspection(state, { type: 'leaderboards/inspect_character', character_id: address })).toBe(state)
  const selected = reduce_inspection(state, { type: 'leaderboards/inspect_character', character_id })
  expect(inspection_request(selected).query).toEqual({ kind: 'equipment', address, character_id })
  expect(reduce_inspection(selected, { type: 'leaderboards/inspect_character', character_id })).toBe(selected)
  const bare = fold_inspection(selected, {
    type: 'packet/inspection_result',
    id: selected.id,
    result: { kind: 'equipment', equipment: [] },
  })
  expect(bare).toMatchObject({ status: 'ready', equipment: [] })
  const missing = fold_inspection(selected, {
    type: 'packet/inspection_result',
    id: selected.id,
    result: { kind: 'equipment', equipment: null },
  })
  expect(missing.status).toBe('missing')
  const refresh = reduce_inspection(missing, { type: 'leaderboards/inspect', address, name: 'hero.sui' })
  expect(refresh).toMatchObject({ selected: null, profile: null, target: state.target })
  expect(inspection_request(refresh).query).toMatchObject({ kind: 'profile', after: null })
})

test('pagination keeps global totals and maxima from the response, without retaining equipment or old pages', () => {
  const state = loaded()
  const next = reduce_inspection(state, { type: 'leaderboards/inspect_page', direction: 'next' })
  expect(inspection_request(next).query).toMatchObject({ after: character_id })
  expect(next.profile).toBeNull()
  const last = fold_inspection(next, {
    type: 'packet/inspection_result',
    id: next.id,
    result: { kind: 'profile', profile: { ...profile, characters: [], next: null } },
  })
  expect(last.profile).toMatchObject({ character_count: 41, jobs: [{ job: 'MINER', level: 100 }] })
  expect(reduce_inspection(last, { type: 'leaderboards/inspect_page', direction: 'next' })).toBe(last)
  const previous = reduce_inspection(last, { type: 'leaderboards/inspect_page', direction: 'previous' })
  expect(inspection_request(previous).query).toMatchObject({ after: null })
})

test('navigation and disconnect release inspection without changing gameplay selection', () => {
  const before = {
    navigation: { page: 'leaderboard' },
    session: { link_status: 'ready', selected_character: 'mine' },
    leaderboards: { ...initial_leaderboards_state(), inspection: loaded() },
  } as unknown as AppState
  const after = leaderboards.reduce!(
    { ...before, navigation: { ...before.navigation, page: 'world' } },
    { type: 'page/open', page: 'world' }
  )
  expect(after.leaderboards.inspection.target).toBeNull()
  expect(after.session).toBe(before.session)
  expect(inspection_subscription(after, before)).toMatchObject({ query: null })
  const disconnected = reduce_leaderboards(before.leaderboards, { type: 'auth/disconnected' })
  expect(disconnected.inspection.target).toBeNull()
  expect(disconnected.inspection.id).toBe(before.leaderboards.inspection.id)
  expect(
    reduce_leaderboards(before.leaderboards, {
      type: 'server/packet',
      packet: { type: 'packet/inspection_error', id: 99 },
    })
  ).toBe(before.leaderboards)
})
