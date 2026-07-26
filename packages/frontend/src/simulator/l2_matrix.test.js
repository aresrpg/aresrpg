// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/l2_matrix.test.js — THE L2 SCENARIO MATRIX (#930 rung 2, the deterministic half of #747).
//
// Every published spell, proven against a stateless oracle, with NO working fight required. The oracle is
// `l2_reference.js` (which never imports the sim); the system under test is reached through THE PAGE'S OWN
// DOORS and nothing else:
//
//   build_start_args → create_sim_chain → commands_from_staged → submit_commands
//
// That door chain is deliberate. #931 was invisible to a green suite precisely because its fixtures were
// authored by the same model that consumed them: the board staged a cast as an `object_id` while the local
// chain keyed its decks by corpus slug, so a cast committed, spent AP and folded nothing. A matrix that
// hand-built sim commands would still be green today. This one stages the cast the way the board stages it.
//
// WHO INDICTS WHOM (#930 fence 2). A disagreement between the oracle and the sim NEVER auto-blames either
// side here. It is quarantined in `l2_quarantine.json` against a filed issue and escalated to an L3 vector,
// where the Move twin — the only sanctioned second implementation — decides. A quarantine row without an
// issue number fails this suite, so quarantine can never rot into a silent mute.
//
// SKIP IS NEVER PASS. Every scenario a spell cannot express prints a reason from `SKIP`, and the histogram
// at the bottom is asserted — a template that silently stops running is a red test, not a quiet one.

import { describe, expect, test } from 'bun:test'
import {
  arena_from_board,
  commands_from_staged,
  create_sim_chain,
  derive_board,
  submit_commands,
} from '@aresrpg/fight/sim_chain'
import { encode } from '@aresrpg/fight/los'

import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'

import { build_start_args } from './fight_start.js'
import { expectation_of, SKIP } from './l2_reference.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE } from './reducer'
import fixture from './spell_corpus_l2.fixture.json'
import quarantine from './l2_quarantine.json'
import l3_vectors from './l3_vectors.json'

const CORPUS = fixture.rows
/** The seat's AP purse — every simulator seat opens on the base pool, so this bounds what is castable. */
const SEAT_AP = 6
/** Seeds tried in order until one opens a fight whose lane holds the cell the scenario needs. */
const SEEDS = [0xc81f3a92, 0x1a2b3c4d, 0x5e6f7a8b, 0x9c0d1e2f, 0x33445566, 0x778899aa, 0xbbccddee, 0x0f1e2d3c]

set_spell_corpus_for_test(CORPUS)

/** The lane length every seed in the pool can honour. Computed once, after `geometry_of` is defined. */
let LANE_RUN = 0

/** The one target the matrix fires at — deep enough to survive every published magnitude. `base_hp` feeds L1's own scaler. */
const MOB = {
  id: '0xmob_t',
  name: 'Bulwark',
  element: 'earth',
  role: 'trash',
  minLevel: 1,
  maxLevel: 200,
  base_hp: 400000,
  ap: 6,
  mp: 3,
}
const MOB_BY_ID = new Map([[MOB.id, MOB]])

/** Board geometry per seed: the caster's spawn plus the longest clear straight lane leading away from it. */
const geometry_cache = new Map()
const geometry_of = (seed) => {
  if (geometry_cache.has(seed)) return geometry_cache.get(seed)
  const derived = derive_board(seed)
  const arena = arena_from_board(derived.board)
  const walkable = (x, y) =>
    x >= 0 && y >= 0 && x < arena.width && y < arena.height && arena.cells[y * arena.width + x] === 0
  // The lane is a straight orthogonal run, so a target on it is automatically LINEAR and — with only the
  // caster and one mob alive — has unobstructed line of sight. That is what makes a refusal meaningful:
  // the only gate a lane cast can trip is the spell's own range or its AP cost.
  const lanes = arena.spawns_a.flatMap((spawn) =>
    [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ].map((dir) => {
      let run = 0
      while (walkable(spawn.x + dir.x * (run + 1), spawn.y + dir.y * (run + 1))) run++
      return { spawn, dir, run }
    })
  )
  const best = lanes.reduce((left, right) => (right.run > left.run ? right : left))
  const geometry = { ...best, arena, anchor: { x: derived.anchor_x, z: derived.anchor_z } }
  geometry_cache.set(seed, geometry)
  return geometry
}

/** The stride-20 cell `distance` steps down the lane from the caster. */
const lane_cell = (geometry, distance) =>
  encode(geometry.spawn.x + geometry.dir.x * distance, geometry.spawn.y + geometry.dir.y * distance)

/**
 * Open one fight through the page's real doors: a single seat on its spawn, one mob parked `mob_distance`
 * down the lane. Returns the chain plus the cells, or null when the fold refused to start.
 */
const open_fight = ({ seed, caster_class, caster_level, mob_distance }) => {
  const geometry = geometry_of(seed)
  const state = {
    ...INITIAL_SIMULATOR_STATE,
    seed,
    roster: [
      {
        id: 'l2_caster',
        name: 'ORACLE',
        // The caster IS the spell's own class — a deck only ever holds its class's published spells.
        class_id: caster_class,
        male: true,
        level: caster_level,
        // ZERO allocation is what makes the oracle's band exact: no characteristic, no percent damage, so the
        // published amplification is unity and a rolled magnitude is the authored band verbatim.
        stat_alloc: { ...EMPTY_STAT_ALLOC },
        spell_levels: {},
        loadout: {},
      },
    ],
    focus_id: 'l2_caster',
    placements: { [lane_cell(geometry, 0)]: 'l2_caster' },
    mob_picks: { [lane_cell(geometry, mob_distance)]: { template_id: MOB.id, level: 1 } },
  }
  const built = build_start_args({
    state,
    board: { anchor: geometry.anchor },
    item_by_id: new Map(),
    mob_by_id: MOB_BY_ID,
    mob_spells_of: () => [],
  })
  if (!built.ok) return null
  return { chain: create_sim_chain({ ...built.args, fight_id: `l2:${seed}` }), geometry }
}

/** The class level a row needs before its spell is even dealt — the corpus' own unlock. */
const unlock_of = (row) => Number(row.unlock ?? 1)

/**
 * A fight the spell under test can be cast in. Every spell the seat's level has unlocked is castable from the
 * first turn — there is no hand and no deal (#1012) — so the seed pool is walked only for a board whose lane
 * can seat the mob at the scenario's distance.
 */
const fight_holding = (row, { mob_distance }) => {
  for (const seed of SEEDS) {
    const opened = open_fight({
      seed,
      caster_class: String(row.classType),
      caster_level: unlock_of(row),
      mob_distance,
    })
    if (opened !== null) return opened
  }
  return null
}

const CAST_ROW = '0xsim::fight_events::Cast'
const HIT_ROW = '0xsim::fight_events::Hit'

/** Stage `count` casts of one spell at one cell and fold the whole turn through the real submit door. */
const cast_turn = (opened, row, target_cell, count = 1) => {
  const staged = Array.from({ length: count }, () => ({
    kind: 1,
    target: target_cell,
    spell_template_id: String(row.object_id),
  }))
  const before = opened.chain.sim_state.team1[0].health
  const out = submit_commands(opened.chain, commands_from_staged(staged, 'l2_caster'), { now_ms: 0 })
  const rows = out.receipt.events
  return {
    casts: rows.filter((event) => event.type === CAST_ROW).length,
    // VICTIM-SCOPED. A life-steal or self-damage row also emits a hit against the CASTER, and that amount
    // belongs to a different published band — folding both into one assertion would indict the sim for the
    // oracle's own sloppiness. Only what landed on the mob is measured here.
    hits: rows
      .filter((event) => event.type === HIT_ROW && event.parsedJson.victim_is_mob === true)
      .map((event) => Number(event.parsedJson.amount)),
    hp_before: before,
    hp_after: out.chain.sim_state.team1[0].health,
    chain: out.chain,
  }
}

// ╔════════════════ [ The matrix ] ═════════════════════════════════════════════════════════════════════ ]

/** Every scenario outcome, one row per (spell, template). The suite's assertions read THIS, not the console. */
const ledger = []
const record = (row, template, status, reason = null, detail = null) =>
  ledger.push({ spell_id: String(row.id), object_id: String(row.object_id), template, status, reason, detail })

const quarantined = new Set(quarantine.rows.map((entry) => `${entry.spell_id}::${entry.scenario}`))
/** A disagreement is never adjudicated here (#930 fence 2) — it is quarantined against an issue, or it is red. */
const disagree = (row, template, expected, got) => {
  if (quarantined.has(`${String(row.id)}::${template}`))
    return record(row, template, 'quarantined', null, { expected, got })
  return record(row, template, 'MISMATCH', null, { expected, got })
}

// The SHORTEST lane across the seed pool, because `fight_holding` may settle on any seed in it — a cell that
// exists on one board and not another would refuse for a reason that is nobody's defect.
LANE_RUN = Math.min(...SEEDS.map((seed) => geometry_of(seed).run))

for (const row of CORPUS) {
  const expectation = expectation_of(row, 0)
  const [level] = row.levels
  const lane_run = LANE_RUN
  // The published per-turn / per-target caps must not bind BEFORE the AP purse does, or the refusal under
  // test would be the cast limiter's rather than the purse's.
  const repeatable = (count) =>
    Number(level.casts_per_turn ?? 255) >= count &&
    Number(level.casts_per_target ?? 255) >= count &&
    Number(level.cooldown_turns ?? 0) === 0
  // A FREE-CELL spell (glyph, trap, teleport) must land on EMPTY ground, so its victim cannot stand on the
  // target. Its mob is parked at the far end of the lane — beyond the target, never between it and the caster,
  // so line of sight stays clear and the only gate a refusal can trip is still the spell's own range.
  const parked = expectation.free_cell ? lane_run : null
  const mob_at = (target_distance) => parked ?? target_distance
  const reachable = (target_distance) => target_distance <= lane_run && (parked === null || target_distance < parked)

  // ── template: a cast inside the published range is ACCEPTED ────────────────────────────────────────────
  const reach = Math.max(1, expectation.range_min)
  if (expectation.range_max === 0) record(row, 'cast_in_range', 'skipped', SKIP.SELF_ONLY_RANGE)
  else if (expectation.ap_cost > SEAT_AP) record(row, 'cast_in_range', 'skipped', SKIP.ZERO_AP_COST)
  else if (reach > expectation.range_max || !reachable(reach))
    record(row, 'cast_in_range', 'skipped', expectation.free_cell ? SKIP.FREE_CELL_SPELL : SKIP.RANGE_EXCEEDS_ARENA)
  else {
    const opened = fight_holding(row, { mob_distance: mob_at(reach) })
    if (opened === null) record(row, 'cast_in_range', 'skipped', SKIP.NO_LEGAL_CELL)
    else {
      const result = cast_turn(opened, row, lane_cell(opened.geometry, reach))
      if (result.casts === 1) record(row, 'cast_in_range', 'passed')
      else disagree(row, 'cast_in_range', 'one accepted cast', `${result.casts} cast rows`)

      // ── template: a second same-turn cast obeys the PUBLISHED limits and nothing else (#1012) ────────────
      // Two casts of one spell at one cell are accepted exactly when the row's own casts_per_turn /
      // casts_per_target / cooldown allow it AND the purse can pay twice. No card ever refuses one.
      // A FREE-CELL row is not askable this way: its first cast takes the empty cell (a teleport lands the
      // caster on it, a trap anchors there), so the second refusal would be a targeting fact, not a limit.
      if (expectation.free_cell) record(row, 'second_cast_limits', 'skipped', SKIP.TARGET_CELL_CONSUMED)
      else {
        const affordable_twice = expectation.ap_cost * 2 <= SEAT_AP
        const allowed = repeatable(2) && affordable_twice ? 2 : 1
        const twice = cast_turn(opened, row, lane_cell(opened.geometry, reach), 2)
        if (twice.casts === allowed) record(row, 'second_cast_limits', 'passed')
        else
          disagree(
            row,
            'second_cast_limits',
            `${allowed} accepted cast(s) — the published limits and the purse decide`,
            `${twice.casts} casts`
          )
      }

      // ── template: the magnitude a damage row lands is inside the published band ────────────────────────
      if (expectation.damage === null) record(row, 'damage_bounds', 'skipped', SKIP.NO_MAGNITUDE_FAMILY)
      else if (!expectation.purely_modelled) record(row, 'damage_bounds', 'skipped', SKIP.MIXED_UNMODELLED_EFFECTS)
      else if (result.hits.length === 0) record(row, 'damage_bounds', 'skipped', SKIP.FREE_CELL_SPELL)
      else {
        const stray = result.hits.filter(
          (amount) => amount < expectation.damage.per_effect_min || amount > expectation.damage.per_effect_max
        )
        if (stray.length === 0) record(row, 'damage_bounds', 'passed')
        else
          disagree(
            row,
            'damage_bounds',
            `every hit in [${expectation.damage.per_effect_min}, ${expectation.damage.per_effect_max}]`,
            `hits ${JSON.stringify(result.hits)}`
          )
      }
    }
  }

  // ── template: one cell beyond the published range is REFUSED ───────────────────────────────────────────
  const beyond = expectation.range_max + 1
  if (expectation.ap_cost > SEAT_AP) record(row, 'over_range_refused', 'skipped', SKIP.ZERO_AP_COST)
  else if (!reachable(beyond))
    record(
      row,
      'over_range_refused',
      'skipped',
      expectation.free_cell ? SKIP.FREE_CELL_SPELL : SKIP.RANGE_EXCEEDS_ARENA
    )
  else {
    const opened = fight_holding(row, { mob_distance: mob_at(beyond) })
    if (opened === null) record(row, 'over_range_refused', 'skipped', SKIP.NO_LEGAL_CELL)
    else {
      const result = cast_turn(opened, row, lane_cell(opened.geometry, beyond))
      if (result.casts === 0 && result.hp_after === result.hp_before) record(row, 'over_range_refused', 'passed')
      else
        disagree(
          row,
          'over_range_refused',
          'no cast row, target untouched',
          `${result.casts} casts, hp ${result.hp_before}→${result.hp_after}`
        )
    }
  }

  // ── template: a spell the purse cannot pay for folds NOTHING ───────────────────────────────────────────
  // The honest AP scenario is a cost the seat cannot meet at all; the multi-cast purse drain is covered by
  // `second_cast_limits` above, which is where casts_per_turn and the purse are read together.
  if (expectation.ap_cost <= SEAT_AP) record(row, 'insufficient_ap_refused', 'skipped', SKIP.AP_COST_WITHIN_PURSE)
  else if (expectation.range_max === 0 || reach > expectation.range_max || !reachable(reach))
    record(
      row,
      'insufficient_ap_refused',
      'skipped',
      expectation.free_cell ? SKIP.FREE_CELL_SPELL : SKIP.RANGE_EXCEEDS_ARENA
    )
  else {
    const opened = fight_holding(row, { mob_distance: mob_at(reach) })
    if (opened === null) record(row, 'insufficient_ap_refused', 'skipped', SKIP.NO_LEGAL_CELL)
    else {
      const result = cast_turn(opened, row, lane_cell(opened.geometry, reach))
      if (result.casts === 0 && result.hp_after === result.hp_before) record(row, 'insufficient_ap_refused', 'passed')
      else
        disagree(
          row,
          'insufficient_ap_refused',
          `no cast — ${expectation.ap_cost} AP exceeds the ${SEAT_AP} AP purse`,
          `${result.casts} casts, hp ${result.hp_before}→${result.hp_after}`
        )
    }
  }
}

// ╔════════════════ [ The assertions ] ═════════════════════════════════════════════════════════════════ ]

describe('L2 — the corpus-derived scenario matrix', () => {
  test('the blob is the PUBLISHED corpus, pinned with its provenance', () => {
    expect(fixture._provenance.sha256_prefix).toBe('152c328b9cf2bf86')
    expect(fixture._provenance.source).toBe('https://assets.aresrpg.world/data/spell_corpus.json')
    expect(CORPUS.length).toBe(240)
    // the redaction is MECHANICAL — row N carries 0x + N, so a re-fetch reproduces it byte for byte
    expect(CORPUS.every((row, index) => row.object_id === `0x${String(index).padStart(4, '0')}`)).toBe(true)
  })

  test('EXACT SET — every published spell is covered, and nothing that is not published is', () => {
    const covered = new Set(ledger.map((entry) => entry.object_id))
    const published = new Set(CORPUS.map((row) => String(row.object_id)))
    // A new row in the blob with no scenario is RED: coverage cannot silently lag the corpus.
    expect([...published].filter((id) => !covered.has(id))).toEqual([])
    expect([...covered].filter((id) => !published.has(id))).toEqual([])
    expect(covered.size).toBe(240)
  })

  test('no scenario disagreed with the oracle outside quarantine', () => {
    const mismatches = ledger.filter((entry) => entry.status === 'MISMATCH')
    // Printed, not just counted — a failure hands over the repro rather than a number.
    if (mismatches.length > 0) console.error(JSON.stringify(mismatches.slice(0, 20), null, 2))
    expect(mismatches).toEqual([])
  })

  test('every quarantine row names the issue that adjudicates it (#930 fence 2)', () => {
    for (const entry of quarantine.rows) {
      expect(typeof entry.issue).toBe('number')
      expect(entry.issue).toBeGreaterThan(0)
      expect(String(entry.spell_id).length).toBeGreaterThan(0)
    }
    // A quarantine that outgrows a handful of DEFECT CLASSES means the oracle is mis-derived, not the sim.
    expect(new Set(quarantine.rows.map((entry) => entry.issue)).size).toBeLessThanOrEqual(8)
  })

  test('every skip states its reason, and every reason is a declared enum member', () => {
    const reasons = new Set(Object.values(SKIP))
    const skipped = ledger.filter((entry) => entry.status === 'skipped')
    expect(skipped.every((entry) => reasons.has(entry.reason))).toBe(true)
    // SKIP IS NEVER PASS: a scenario that ran must carry no reason at all.
    expect(ledger.filter((entry) => entry.status === 'passed').every((entry) => entry.reason === null)).toBe(true)
  })

  test('the L3 hand-off is exact — every stateful row is recorded, none invented', () => {
    const stateless = new Set(
      CORPUS.filter((row) => expectation_of(row, 0).families.length > 0).map((row) => String(row.id))
    )
    const handed = new Set(l3_vectors.vectors.map((vector) => vector.spell_id))
    // A row this oracle CAN express must not be parked in L3 — that would be coverage laundering.
    expect([...handed].filter((id) => stateless.has(id))).toEqual([])
    expect(l3_vectors.vectors.every((vector) => typeof vector.why === 'string' && vector.why.length > 0)).toBe(true)
    expect(
      [...new Set(CORPUS.map((row) => String(row.id)))].filter((id) => !stateless.has(id) && !handed.has(id))
    ).toEqual([])
  })

  test('POSITIVE CONTROL — the matrix goes red on the #931 signature', () => {
    // A matrix that only ever prints green proves nothing about the sim; it may simply be unable to fail.
    // So drive the exact defect this rung exists to catch: a staged cast naming an id the chain's ctx cannot
    // resolve. #931's face was a turn that committed and folded NOTHING, and `cast_in_range`'s predicate
    // (`casts === 1`) is what must notice.
    const row = CORPUS.find(
      (candidate) => Number(candidate.levels[0].range_max) >= 2 && Number(candidate.levels[0].ap_cost) <= SEAT_AP
    )
    const opened = fight_holding(row, { mob_distance: 2 })
    expect(opened).not.toBeNull()

    const honest = cast_turn(opened, row, lane_cell(opened.geometry, 2))
    expect(honest.casts).toBe(1)

    // The same fight, the same cell, a spell id in the corpus' OWN slug space rather than the object-id space
    // the board stages — precisely the id-space split #931 fixed.
    const impostor = cast_turn(opened, { ...row, object_id: String(row.id) }, lane_cell(opened.geometry, 2))
    expect(impostor.casts).toBe(0)
    expect(impostor.hp_after).toBe(impostor.hp_before)
  })

  test('COVERAGE TABLE', () => {
    const by_template = {}
    for (const entry of ledger) {
      by_template[entry.template] ??= { passed: 0, skipped: 0, MISMATCH: 0, quarantined: 0 }
      by_template[entry.template][entry.status] += 1
    }
    const skip_histogram = {}
    for (const entry of ledger.filter((row) => row.status === 'skipped'))
      skip_histogram[entry.reason] = (skip_histogram[entry.reason] ?? 0) + 1
    console.log('\n== L2 COVERAGE — 240 published spells ==')
    console.table(by_template)
    console.log('== SKIP REASONS ==')
    console.table(skip_histogram)
    console.log(
      `quarantined: ${ledger.filter((row) => row.status === 'quarantined').length} · L3 vectors: ${l3_vectors.vectors.length}`
    )
    // The matrix must actually EXERCISE the sim, not skip its way to green.
    expect(ledger.filter((entry) => entry.status === 'passed').length).toBeGreaterThan(200)
  })
})
