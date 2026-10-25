// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'
import { action_key, type TournamentInput } from '../../src/modules/tournament.ts'
import { tournament_fixture } from '../helpers/tournament.ts'

const initial = () => initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
const row = tournament_fixture()
const loaded = () =>
  reduce_app_state(initial(), { type: 'server/packet', packet: { type: 'packet/tournaments', tournaments: [row] } })
const failure = (): Extract<TournamentInput, { type: 'tournament/entry_result' }> => ({
  type: 'tournament/entry_result',
  key: action_key(row, { kind: 'enter', index: 0, character: 'a' }),
  entry: { id: row.id, index: 0, character: 'a', version: row.version },
  reason: 'Insufficient gas',
})

test('write outcomes belong to the current operation and survive pending cleanup', () => {
  const pending = reduce_app_state(loaded(), { type: 'tournament/pending', key: 'donation' })
  const confirmed = reduce_app_state(pending, { type: 'tournament/outcome', key: 'donation', reason: null })
  expect(confirmed.tournament.outcome).toEqual({ key: 'donation', reason: null })
  const cleared = reduce_app_state(confirmed, { type: 'tournament/pending', key: null })
  expect(cleared.tournament.outcome).toEqual(confirmed.tournament.outcome)
  const next = reduce_app_state(cleared, { type: 'tournament/pending', key: 'another' })
  expect(next.tournament.outcome).toBeNull()
  expect(reduce_app_state(next, { type: 'tournament/outcome', key: 'donation', reason: 'late' })).toBe(next)
  const failed = reduce_app_state(next, { type: 'tournament/outcome', key: 'another', reason: 'insufficient gas' })
  expect(failed.tournament.outcome?.reason).toBe('insufficient gas')
  expect(reduce_app_state(failed, { type: 'auth/disconnected' }).tournament.outcome).toBeNull()
})

test('loading, failed reads, loaded-empty, and reconnects remain distinct without deleting known rows', () => {
  expect(initial().tournament.feed_status).toBe('loading')
  const known = loaded()
  expect(known.tournament.feed_status).toBe('loaded')
  const failed = reduce_app_state(known, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments_error', reason: 'unavailable' },
  })
  expect(failed.tournament.feed_status).toBe('unavailable')
  expect(failed.tournament.rows).toBe(known.tournament.rows)
  const reconnecting = reduce_app_state(failed, { type: 'link/connecting' })
  expect(reconnecting.tournament.feed_status).toBe('loading')
  expect(reduce_app_state(reconnecting, { type: 'link/failed', error: 'offline' }).tournament.feed_status).toBe(
    'unavailable'
  )
  const empty = reduce_app_state(failed, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [] },
  })
  expect(empty.tournament.feed_status).toBe('loaded')
  expect(empty.tournament.rows).toEqual([])
})

test('entry failures clear on success or confirmed admission, and late failures cannot resurrect them', () => {
  const input = failure()
  const failed = reduce_app_state(loaded(), input)
  expect(failed.tournament.entry_failures[input.key].reason).toBe('Insufficient gas')
  expect(reduce_app_state(failed, { ...input, reason: null }).tournament.entry_failures).toEqual({})
  const admitted = reduce_app_state(failed, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [{ ...row, matches: [{ ...row.matches[0], joined: ['a'] }] }] },
  })
  expect(admitted.tournament.entry_failures).toEqual({})
  expect(reduce_app_state(admitted, input).tournament.entry_failures).toEqual({})
})

test('newer snapshots and a newly linked fight retire old errors while stale packets preserve current errors', () => {
  const input = failure()
  const failed = reduce_app_state(loaded(), input)
  const stale = reduce_app_state(failed, {
    type: 'server/packet',
    packet: { type: 'packet/tournaments', tournaments: [{ ...row, version: '4' }] },
  })
  expect(stale.tournament.entry_failures).toEqual(failed.tournament.entry_failures)
  const linked = reduce_app_state(failed, {
    type: 'server/packet',
    packet: {
      type: 'packet/tournaments',
      tournaments: [{ ...row, version: '6', matches: [{ ...row.matches[0], fight: 'fight' }] }],
    },
  })
  expect(linked.tournament.entry_failures).toEqual({})
  expect(reduce_app_state(linked, input).tournament.entry_failures).toEqual({})
  expect(reduce_app_state(failed, { type: 'auth/disconnected' }).tournament.entry_failures).toEqual({})
})
