// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { apply_invisibility, is_invisible } from '../src/fight_statuses.js'
import * as SE from '../src/spell_effect.js'

import {
  CAST_CTX,
  CLASS_OF,
  ENEMY_CELL,
  KIND_NAME,
  KNOWN_UNSUPPORTED,
  SPELLS_CORPUS_AVAILABLE,
  drive_effect,
  fresh_state,
  run_matrix,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// THE SPELL-EFFECT CONFORMANCE MATRIX gate. Engine + full rationale live in the sibling
// spell_effect_conformance_matrix.js (imported here and by the MATRIX_CONVICTIONS.md generator — one home).
// Owner survival mechanism: "270 spells — if not 100% of effects are fully tested and functional, how are we
// gonna survive?" This drives EVERY declared effect of the real mainnet corpus through the reducer and asserts
// its effect-class POSTCONDITION held in FightState. The SURVIVAL GATE: no SUPPORTED effect kind may fail
// (a working spell silently breaking = RED); the KNOWN-unsupported kinds are the enumerated burn-down worklist.

const MATRIX = run_matrix()

describe('spell-effect conformance matrix — real corpus × reducer postconditions', () => {
  // MISSING-ARTIFACT (#96): seed/mainnet/spells is generated content from the content pipeline (private
  // repo), absent by design here — CORPUS degrades to [] (spell_effect_conformance_matrix.js), so the two
  // corpus-cardinality assertions below cannot hold. The other 4 tests in this describe are self-contained
  // (harness anti-lying self-tests + the vacuously-true worklist-currency check) and keep running for real.
  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'corpus is loaded (the on-chain class spell files)',
    () => {
      expect(MATRIX.spells).toBeGreaterThanOrEqual(240)
      expect(MATRIX.drives).toBeGreaterThan(MATRIX.spells) // base + crit effects per spell
    },
  )

  // ── THE SURVIVAL GATE: no SUPPORTED effect kind may fail its postcondition ──────────────────────────
  // A conviction whose kind is NOT on the known-unsupported worklist == a working spell silently broke.
  test('NO SUPPORTED effect kind regresses (every conviction is a KNOWN-unsupported kind)', () => {
    const surprises = MATRIX.convictions.filter(
      c => !KNOWN_UNSUPPORTED.has(c.kind),
    )
    const report = surprises
      .map(
        c =>
          `  ${c.spell_id} [${c.slot}] kind ${c.kind} (${c.name}) · ${c.cls} · ${c.detail}`,
      )
      .join('\n')
    expect(
      surprises.length,
      `SUPPORTED spell effects that FAILED their postcondition (regressions):\n${report}`,
    ).toBe(0)
  })

  // ── COVERAGE: every corpus kind is exercised and classified (no silent unclassified kind) ───────────
  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'every corpus effect kind is exercised and has a class row',
    () => {
      const unclassified = [...MATRIX.kinds_seen].filter(
        k => CLASS_OF[k] === undefined,
      )
      expect(
        unclassified,
        `corpus kinds with NO matrix class row: ${unclassified.map(KIND_NAME).join(', ')}`,
      ).toEqual([])
      // The corpus must span a broad slice of the vocabulary (guards against loading an empty/partial corpus).
      expect(MATRIX.kinds_seen.size).toBeGreaterThanOrEqual(25)
    },
  )

  // ── CENSUS: the worklist stays honest — every known-unsupported kind STILL convicts in the corpus ───
  // If a kind here stops convicting, it was implemented (or de-authored): update the worklist
  // (KNOWN_UNSUPPORTED + MATRIX_CONVICTIONS.md). This is the burn-down ratchet.
  test('known-unsupported worklist is current (each listed kind still convicts)', () => {
    const convicted_kinds = new Set(MATRIX.convictions.map(c => c.kind))
    const stale = [...KNOWN_UNSUPPORTED.keys()].filter(
      k => MATRIX.kinds_seen.has(k) && !convicted_kinds.has(k),
    )
    expect(
      stale,
      `worklist kinds that NO LONGER convict (implemented or de-authored — remove from KNOWN_UNSUPPORTED + MATRIX_CONVICTIONS.md): ${stale.map(KIND_NAME).join(', ')}`,
    ).toEqual([])
  })

  // ── ANTI-LYING: the harness drives REAL casts, and its checker catches a deliberately broken effect ──
  test('harness is live: a real damage effect drops enemy HP', () => {
    const clean = drive_effect('__self_test__', 'base0', {
      kind: SE.K_DAMAGE,
      value: 12,
      element: 2,
      target_filter: SE.TF_NOT_TEAM,
    })
    expect(
      clean,
      'a value-12 K_DAMAGE effect should PASS (enemy HP must drop) — harness is not driving real casts',
    ).toBeNull()
  })

  test('mutation proof: a deliberately zeroed damage effect IS convicted', () => {
    // Same code path, damage neutered to 0 → enemy HP cannot drop → the checker MUST convict it.
    const broken = drive_effect('__mutation__', 'base0', {
      kind: SE.K_DAMAGE,
      value: 0,
      element: 2,
      target_filter: SE.TF_NOT_TEAM,
    })
    expect(
      broken,
      'the matrix rubber-stamped a 0-damage effect — the gate is LYING',
    ).not.toBeNull()
    expect(broken.cls).toBe('damage')
  })

  // ── INVISIBILITY↔REVEAL PARITY (a known-red candidate): the chain emits Revealed when an
  //    invisible fighter deals direct damage; the sim must MIRROR the self-reveal on a damaging cast. ──
  test('parity: an invisible caster is revealed by its own damaging cast (mirrors chain Revealed)', () => {
    const state = fresh_state([])
    const hidden = apply_invisibility(state, 'p0', 'p0', 3)
    expect(is_invisible(find_entity(hidden, 'p0'))).toBe(true)
    const spell = single_effect_spell(
      'reveal_parity',
      {
        kind: SE.K_DAMAGE,
        value: 12,
        element: 2,
        target_filter: SE.TF_NOT_TEAM,
      },
      3,
      false,
    )
    const res = process_spell_cast(hidden, 'p0', spell, 1, ENEMY_CELL, CAST_CTX)
    expect(res.success).toBe(true)
    expect(
      is_invisible(find_entity(res.state, 'p0')),
      'invisible caster stayed hidden after a damaging cast — sim does NOT mirror the chain reveal',
    ).toBe(false)
  })
})
