// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// The shadow fan-out core (build-order step 3, issue #522). RED-FIRST per the ticket: a converging stream
// never logs; an injected divergence logs exactly ONCE per fight + returns a capsule; the throttle survives
// a second divergence and resets on a new fight. Pure, no `window` — see fight_trace_tee.test.js for the
// integration wiring (the disarmed-flag path, and the real one-tap-two-consumers glue).

import { describe, test, expect, beforeEach } from 'bun:test'
import { empty_core_state, ingest, project_board } from '@aresrpg/fight/v2'

import { get_log_buffer, _reset_log_for_test } from '../core/log.js'

import {
  SHADOW_QUERY_PARAM,
  SHADOW_STORAGE_KEY,
  shadow_enabled_from,
  diff_boards,
  create_shadow_driver,
} from './fight_v2_shadow.js'

beforeEach(() => _reset_log_for_test())

describe('shadow_enabled_from — the pure arm check', () => {
  test(`the ?${SHADOW_QUERY_PARAM}=1 query flag arms it`, () => {
    expect(shadow_enabled_from({ search: `?${SHADOW_QUERY_PARAM}=1` })).toBe(true)
  })
  test('a truthy localStorage key arms it', () => {
    expect(shadow_enabled_from({ storage_get: (key) => (key === SHADOW_STORAGE_KEY ? '1' : null) })).toBe(true)
  })
  test('neither present — disarmed', () => {
    expect(shadow_enabled_from({})).toBe(false)
    expect(shadow_enabled_from()).toBe(false)
  })
  test('an unrelated query param, or the flag set to anything but "1" — disarmed', () => {
    expect(shadow_enabled_from({ search: '?other=1' })).toBe(false)
    expect(shadow_enabled_from({ search: `?${SHADOW_QUERY_PARAM}=0` })).toBe(false)
  })
})

describe('diff_boards — the stable-field comparator', () => {
  const board = (overrides = {}) => ({
    active: 'p0',
    fighters: {
      p0: { cell: 5, hp: 70, alive: true, turn_number: 1 },
      m0: { cell: 9, hp: 80, alive: true, turn_number: 0 },
    },
    ...overrides,
  })

  test('identical boards diverge on nothing', () => {
    expect(diff_boards(board(), board())).toEqual([])
  })

  test('a per-fighter cell mismatch is named by its dotted path', () => {
    const v2 = board({ fighters: { ...board().fighters, p0: { cell: 6, hp: 70, alive: true, turn_number: 1 } } })
    expect(diff_boards(board(), v2)).toEqual(['fighters.p0.cell'])
  })

  test('a board-level "whose turn" (active) mismatch is named "active"', () => {
    expect(diff_boards(board(), board({ active: 'm0' }))).toEqual(['active'])
  })

  test('every diverging field is reported, sorted by fighter key then field order', () => {
    const v2 = board({
      active: 'm0',
      fighters: {
        p0: { cell: 6, hp: 60, alive: false, turn_number: 2 },
        m0: { cell: 9, hp: 80, alive: true, turn_number: 0 },
      },
    })
    expect(diff_boards(board(), v2)).toEqual([
      'active',
      'fighters.p0.cell',
      'fighters.p0.hp',
      'fighters.p0.alive',
      'fighters.p0.turn_number',
    ])
  })

  test('a fighter present on only one side diverges on every tracked field', () => {
    const old_board = board()
    const v2 = { active: 'p0', fighters: { p0: old_board.fighters.p0 } } // m0 never arrived on the v2 side
    expect(diff_boards(old_board, v2)).toEqual([
      'fighters.m0.cell',
      'fighters.m0.hp',
      'fighters.m0.alive',
      'fighters.m0.turn_number',
    ])
  })

  test('a null/undefined board is handled without throwing', () => {
    expect(() => diff_boards(undefined, board())).not.toThrow()
    expect(diff_boards(null, { active: null, fighters: {} })).toEqual([])
  })

  test('NaN on both sides of a numeric field is NOT a divergence (NaN !== NaN would otherwise spam every step)', () => {
    const v2 = board({ fighters: { ...board().fighters, p0: { ...board().fighters.p0, hp: NaN } } })
    const old_board = board({ fighters: { ...board().fighters, p0: { ...board().fighters.p0, hp: NaN } } })
    expect(diff_boards(old_board, v2)).toEqual([])
  })
})

// ── create_shadow_driver — the factory, against a REAL v2 core progression ──────────────────────────────
// `old_board` is built by literally folding the SAME envelope through an independent v2 core (`step`) —
// this isolates the driver's OWN logic (feed / throttle / counters / capsule) from whether the two REAL
// pipelines agree in production (fight_trace_tee.test.js covers that end-to-end, with a real store).

const A_FIGHT = {
  width: 12,
  height: 12,
  status: 1,
  participants: [{ character: '0xa', cell: '5', hp: '70', ap: '6', mp: '3' }],
  mobs: [{ cell: '9', hp: '80' }],
}

const opened = (fight_id) => ({
  payload: { kind: 'session_opened', fight_id, my_key: null, ctx: {} },
  observed_at_ms: 0,
})
const snapshot = (fight_id, version, fight = A_FIGHT) => ({
  payload: { kind: 'journal_rows_received', source: 'snapshot', fight_id, version, rows: fight },
  observed_at_ms: 1,
})
const hit_receipt = (fight_id, version, remaining_hp, at) => ({
  payload: {
    kind: 'journal_rows_received',
    source: 'receipt',
    fight_id,
    version,
    rows: {
      events: [
        {
          type: '0x0::fight_events::Hit',
          parsedJson: { fight: fight_id, victim_is_mob: true, victim_idx: 0, remaining_hp },
        },
      ],
    },
  },
  observed_at_ms: at,
})

/** A standalone v2 core the test drives IN PARALLEL to the shadow's own internal one, purely to compute an
 *  honest "what the board looks like after this envelope" reference (the "old_board" a converging real
 *  pipeline would independently have produced for the identical input). */
const build_reference = () => {
  let state = empty_core_state()
  return {
    /** Fold `envelope` and return the resulting board. Call exactly once per envelope, in order. */
    step: (envelope) => {
      state = ingest(state, envelope)
      return project_board(state)
    },
  }
}

describe('create_shadow_driver — converging stream', () => {
  test('an identical old_board at every step never diverges, never logs', () => {
    const shadow = create_shadow_driver()
    const ref = build_reference()
    for (const envelope of [opened('0xf1'), snapshot('0xf1', 100), hit_receipt('0xf1', 200, 70, 2)])
      expect(shadow.ingest_envelope(envelope, ref.step(envelope))).toEqual({ diverged: false })

    expect(shadow.status()).toEqual({ fights_shadowed: 1, divergences: 0, last: null })
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow')).toEqual([])
  })

  test('fights_shadowed counts distinct session_opened envelopes', () => {
    const shadow = create_shadow_driver()
    const ref = build_reference()
    shadow.ingest_envelope(opened('0xf1'), ref.step(opened('0xf1')))
    shadow.ingest_envelope(opened('0xf2'), ref.step(opened('0xf2')))
    expect(shadow.status().fights_shadowed).toBe(2)
  })
})

describe('create_shadow_driver — an injected divergence', () => {
  test('logs exactly ONE structured game_log line + returns exactly one capsule dump', () => {
    const shadow = create_shadow_driver({ app_version: 'test-1' })
    const ref = build_reference()
    shadow.ingest_envelope(opened('0xf1'), ref.step(opened('0xf1')))
    shadow.ingest_envelope(snapshot('0xf1', 100), ref.step(snapshot('0xf1', 100)))

    const env = hit_receipt('0xf1', 200, 70, 2)
    const real_board = ref.step(env)
    const lying_board = {
      ...real_board,
      fighters: { ...real_board.fighters, m0: { ...real_board.fighters.m0, hp: 9999 } },
    }

    const verdict = shadow.ingest_envelope(env, lying_board)
    expect(verdict.diverged).toBe(true)
    expect(verdict.first_for_fight).toBe(true)
    expect(verdict.fight_id).toBe('0xf1')
    expect(verdict.fields).toEqual(['fighters.m0.hp'])
    expect(verdict.capsule).toMatchObject({ trace_format: 2, session_id: '0xf1', app_version: 'test-1' })
    expect(verdict.capsule.capsules.length).toBe(3) // opened + snapshot + this receipt, this fight only

    const logs = get_log_buffer().filter((e) => e.ns === 'v2-shadow')
    expect(logs.length).toBe(1)
    expect(logs[0].message).toContain('0xf1')
    expect(logs[0].message).toContain('fighters.m0.hp')

    expect(shadow.status()).toMatchObject({ divergences: 1, last: { fight_id: '0xf1', fields: ['fighters.m0.hp'] } })
  })

  test('a SECOND divergence in the SAME fight counts but does not re-log or re-dump', () => {
    const shadow = create_shadow_driver()
    const ref = build_reference()
    shadow.ingest_envelope(opened('0xf1'), ref.step(opened('0xf1')))

    const env1 = snapshot('0xf1', 100)
    shadow.ingest_envelope(env1, { ...ref.step(env1), active: 'wrong' }) // first divergence

    const env2 = hit_receipt('0xf1', 200, 70, 2)
    const verdict2 = shadow.ingest_envelope(env2, { ...ref.step(env2), active: 'still-wrong' }) // second

    expect(verdict2.diverged).toBe(true)
    expect(verdict2.first_for_fight).toBe(false)
    expect(verdict2.capsule).toBeUndefined()
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow').length).toBe(1) // still exactly one
    expect(shadow.status().divergences).toBe(2) // both occurrences counted
  })

  test('a NEW fight resets the throttle — its own first divergence logs again', () => {
    const shadow = create_shadow_driver()
    const ref = build_reference()
    shadow.ingest_envelope(opened('0xf1'), ref.step(opened('0xf1')))
    const env1 = snapshot('0xf1', 100)
    shadow.ingest_envelope(env1, { ...ref.step(env1), active: 'wrong' })
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow').length).toBe(1)

    shadow.ingest_envelope(opened('0xf2'), ref.step(opened('0xf2')))
    const env2 = snapshot('0xf2', 100)
    const verdict = shadow.ingest_envelope(env2, { ...ref.step(env2), active: 'also-wrong' })

    expect(verdict.first_for_fight).toBe(true)
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow').length).toBe(2)
    expect(shadow.status().fights_shadowed).toBe(2)
  })
})
