// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// The shadow comparator (issue #522). RED-FIRST per the ticket: a converging stream never logs; an injected
// divergence logs exactly ONCE per fight + returns a capsule; the throttle survives a second divergence and
// resets on a new fight. Box 4 reversed the roles — the CORE is truth and the legacy fold is the board on
// trial — so the driver folds nothing of its own and is handed both boards. Pure, no `window`: see
// fight_trace_tee.test.js for the integration wiring (the disarmed-flag path, the one-tap-two-consumers glue).

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

// BOX 3 (issue #522) flipped this switch DEFAULT-ON: the shadow now runs for every session and the flag is a
// KILL switch. These assertions are the inversion of the opt-in era's — nothing but an explicit "0" disarms.
describe('shadow_enabled_from — the pure arm check, default-on', () => {
  test('no flag anywhere — ARMED (the box-3 default)', () => {
    expect(shadow_enabled_from({})).toBe(true)
    expect(shadow_enabled_from()).toBe(true)
  })
  test(`the ?${SHADOW_QUERY_PARAM}=0 query flag is the kill switch`, () => {
    expect(shadow_enabled_from({ search: `?${SHADOW_QUERY_PARAM}=0` })).toBe(false)
  })
  test(`localStorage ${SHADOW_STORAGE_KEY}='0' is the sticky kill switch`, () => {
    expect(shadow_enabled_from({ storage_get: (key) => (key === SHADOW_STORAGE_KEY ? '0' : null) })).toBe(false)
  })
  test(`the opt-in era's spellings still arm it explicitly (?${SHADOW_QUERY_PARAM}=1 / storage '1')`, () => {
    expect(shadow_enabled_from({ search: `?${SHADOW_QUERY_PARAM}=1` })).toBe(true)
    expect(shadow_enabled_from({ storage_get: (key) => (key === SHADOW_STORAGE_KEY ? '1' : null) })).toBe(true)
  })
  test('an EXPLICIT query value beats the stored preference, both directions', () => {
    const stored = (value) => (key) => (key === SHADOW_STORAGE_KEY ? value : null)
    expect(shadow_enabled_from({ search: `?${SHADOW_QUERY_PARAM}=1`, storage_get: stored('0') })).toBe(true)
    expect(shadow_enabled_from({ search: `?${SHADOW_QUERY_PARAM}=0`, storage_get: stored('1') })).toBe(false)
  })
  test('an unrelated query param leaves the default alone — armed', () => {
    expect(shadow_enabled_from({ search: '?other=1' })).toBe(true)
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
    const legacy = board({ fighters: { ...board().fighters, p0: { cell: 6, hp: 70, alive: true, turn_number: 1 } } })
    expect(diff_boards(board(), legacy)).toEqual(['fighters.p0.cell'])
  })

  test('a board-level "whose turn" (active) mismatch is named "active"', () => {
    expect(diff_boards(board(), board({ active: 'm0' }))).toEqual(['active'])
  })

  test('every diverging field is reported, sorted by fighter key then field order', () => {
    const legacy = board({
      active: 'm0',
      fighters: {
        p0: { cell: 6, hp: 60, alive: false, turn_number: 2 },
        m0: { cell: 9, hp: 80, alive: true, turn_number: 0 },
      },
    })
    expect(diff_boards(board(), legacy)).toEqual([
      'active',
      'fighters.p0.cell',
      'fighters.p0.hp',
      'fighters.p0.alive',
      'fighters.p0.turn_number',
    ])
  })

  test('a fighter present on only one side diverges on every tracked field', () => {
    const truth = board()
    const legacy = { active: 'p0', fighters: { p0: truth.fighters.p0 } } // m0 never arrived on the legacy side
    expect(diff_boards(legacy, truth)).toEqual([
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
    const legacy = board({ fighters: { ...board().fighters, p0: { ...board().fighters.p0, hp: NaN } } })
    const truth = board({ fighters: { ...board().fighters, p0: { ...board().fighters.p0, hp: NaN } } })
    expect(diff_boards(legacy, truth)).toEqual([])
  })
})

// ── create_shadow_driver — the factory, against a REAL core progression ────────────────────────────────
// Since box 4 the driver folds NOTHING: the store owns the core and hands both boards over. The truth core
// below plays the store's part — it folds the envelope stream exactly as `state.core` does — while the
// second board is what the legacy fold is claimed to have produced for the same input. This isolates the
// driver's OWN logic (record / throttle / counters / capsule) from whether the two real folds agree in
// production (fight_trace_tee.test.js covers that end-to-end, with a real store).

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

/** The TRUTH side, standing in for the store's own atom: a core folding the identical envelope stream, whose
 *  board and fight_id are what the driver is handed. Call `step` exactly once per envelope, in order. */
const build_truth = () => {
  let state = empty_core_state()
  return {
    step: (envelope) => {
      state = ingest(state, envelope)
      return { truth_board: project_board(state), fight_id: state.fight_id }
    },
  }
}

/** The driver call the tee makes, with a legacy board that AGREES with truth (the converging case). */
const observe_converging = (shadow, truth, envelope) => {
  const { truth_board, fight_id } = truth.step(envelope)
  return shadow.observe(envelope, { truth_board, shadow_board: truth_board, fight_id })
}

describe('create_shadow_driver — converging stream', () => {
  test('a legacy board identical to truth at every step never diverges, never logs', () => {
    const shadow = create_shadow_driver()
    const truth = build_truth()
    for (const envelope of [opened('0xf1'), snapshot('0xf1', 100), hit_receipt('0xf1', 200, 70, 2)])
      expect(observe_converging(shadow, truth, envelope)).toEqual({ diverged: false })

    expect(shadow.status()).toEqual({ fights_shadowed: 1, divergences: 0, last: null })
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow')).toEqual([])
  })

  test('fights_shadowed counts distinct session_opened envelopes', () => {
    const shadow = create_shadow_driver()
    const truth = build_truth()
    observe_converging(shadow, truth, opened('0xf1'))
    observe_converging(shadow, truth, opened('0xf2'))
    expect(shadow.status().fights_shadowed).toBe(2)
  })
})

// The affordance that makes this cheap: FightTimeline drives a 4 Hz `tick` all turn, and neither a tick nor a
// pre-commit draft can move committed truth on EITHER side, so the driver records them and skips only the
// board comparison. A lie fed under those kinds must therefore go unreported — that is the point.
describe('create_shadow_driver — truth-still envelopes: recorded, not compared', () => {
  const tick = (at) => ({ payload: { kind: 'clock_observed', at_ms: at }, observed_at_ms: at })
  const draft = (at) => ({
    payload: { kind: 'player_draft', draft_kind: 'arm', spell_id: 'spell_1' },
    observed_at_ms: at,
  })
  const A_LIE = { active: 'nonsense', fighters: { p0: { cell: -1, hp: -1, alive: false, turn_number: 99 } } }

  test('a LYING legacy board on a tick or a draft never diverges, never logs', () => {
    const shadow = create_shadow_driver()
    const truth = build_truth()
    for (const envelope of [opened('0xf1'), snapshot('0xf1', 100)]) observe_converging(shadow, truth, envelope)

    for (const envelope of [tick(2), draft(3)]) {
      const { truth_board, fight_id } = truth.step(envelope) // fold no-ops for the core too
      expect(shadow.observe(envelope, { truth_board, shadow_board: A_LIE, fight_id })).toEqual({ diverged: false })
    }
    expect(shadow.status()).toMatchObject({ divergences: 0, last: null })
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow')).toEqual([])
  })

  test('a skipped envelope is still RECORDED — it rides the next real divergence capsule', () => {
    const shadow = create_shadow_driver()
    const truth = build_truth()
    for (const envelope of [opened('0xf1'), snapshot('0xf1', 100)]) observe_converging(shadow, truth, envelope)
    for (const envelope of [tick(2), draft(3)]) {
      const { truth_board, fight_id } = truth.step(envelope)
      expect(shadow.observe(envelope, { truth_board, shadow_board: A_LIE, fight_id }).diverged).toBe(false)
    }

    // A truth-MOVING envelope right after: the comparison runs again and the capsule carries all five inputs.
    const env = hit_receipt('0xf1', 200, 70, 4)
    const { truth_board, fight_id } = truth.step(env)
    const shadow_board = {
      ...truth_board,
      fighters: { ...truth_board.fighters, m0: { ...truth_board.fighters.m0, hp: 1 } },
    }
    const verdict = shadow.observe(env, { truth_board, shadow_board, fight_id })

    expect(verdict.fields).toEqual(['fighters.m0.hp'])
    expect(verdict.capsule.capsules.length).toBe(5) // opened + snapshot + tick + draft + this receipt
    expect(verdict.capsule.capsules.map((c) => c.payload.kind)).toEqual([
      'session_opened',
      'journal_rows_received',
      'clock_observed',
      'player_draft',
      'journal_rows_received',
    ])
  })
})

describe('create_shadow_driver — an injected divergence', () => {
  test('logs exactly ONE structured game_log line + returns exactly one capsule dump', () => {
    const shadow = create_shadow_driver({ app_version: 'test-1' })
    const truth = build_truth()
    observe_converging(shadow, truth, opened('0xf1'))
    observe_converging(shadow, truth, snapshot('0xf1', 100))

    const env = hit_receipt('0xf1', 200, 70, 2)
    const { truth_board, fight_id } = truth.step(env)
    const shadow_board = {
      ...truth_board,
      fighters: { ...truth_board.fighters, m0: { ...truth_board.fighters.m0, hp: 9999 } },
    }

    const verdict = shadow.observe(env, { truth_board, shadow_board, fight_id })
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
    const truth = build_truth()
    observe_converging(shadow, truth, opened('0xf1'))

    const env1 = snapshot('0xf1', 100)
    const first = truth.step(env1)
    shadow.observe(env1, { ...first, shadow_board: { ...first.truth_board, active: 'wrong' } })

    const env2 = hit_receipt('0xf1', 200, 70, 2)
    const second = truth.step(env2)
    const verdict2 = shadow.observe(env2, { ...second, shadow_board: { ...second.truth_board, active: 'still-wrong' } })

    expect(verdict2.diverged).toBe(true)
    expect(verdict2.first_for_fight).toBe(false)
    expect(verdict2.capsule).toBeUndefined()
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow').length).toBe(1) // still exactly one
    expect(shadow.status().divergences).toBe(2) // both occurrences counted
  })

  test('a NEW fight resets the throttle — its own first divergence logs again', () => {
    const shadow = create_shadow_driver()
    const truth = build_truth()
    observe_converging(shadow, truth, opened('0xf1'))
    const env1 = snapshot('0xf1', 100)
    const first = truth.step(env1)
    shadow.observe(env1, { ...first, shadow_board: { ...first.truth_board, active: 'wrong' } })
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow').length).toBe(1)

    observe_converging(shadow, truth, opened('0xf2'))
    const env2 = snapshot('0xf2', 100)
    const second = truth.step(env2)
    const verdict = shadow.observe(env2, { ...second, shadow_board: { ...second.truth_board, active: 'also-wrong' } })

    expect(verdict.first_for_fight).toBe(true)
    expect(get_log_buffer().filter((e) => e.ns === 'v2-shadow').length).toBe(2)
    expect(shadow.status().fights_shadowed).toBe(2)
  })
})
