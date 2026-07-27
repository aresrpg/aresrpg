// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST parity fixture for spell_wire.mjs (#1250) — the ONE home the five `new_effect` PTB encoders under
// packages/move/scripts/ now share. The proof pair is CAPTURED live testnet chain bytes (2026-07-26 adjudication,
// re-read from `sui client object`, not memory): Bonelet's authored −17 agility alter_stat stored `value "32751"`
// flags 8; Razkin's authored +25% alter_resist stored `value "32793"` flags 0. Before this fix, seed_full_corpus.mjs
// / seed_spells_phase.mjs (and reseed_plan.mjs's normalize_seed_effect) implemented the RETIRED pre-#904
// magnitude+authored-flag dialect (`Math.abs(value)`, raw flags) instead — run against the SAME authored
// deltas that dialect emits {value:17,flags:0} and {value:25,flags:0}, a MISMATCH against both rows below (the
// red this fixture guards against; reproduced verbatim from the pre-fix source at #1250's fix commit history).
import { describe, expect, test } from 'bun:test'

import { decode_status_value } from '../../fight/src/fight_status_snapshot.js'
import { FLAG_NEGATIVE, K_ALTER_RESIST, K_ALTER_STAT, K_DAMAGE } from '../../sim/src/spell_effect.js'

import { encode_effect_value } from './spell_wire.mjs'

describe('encode_effect_value — the CENTERED dialect (#904 final ruling, #1250 the one home)', () => {
  test('Bonelet: authored −17 agility (alter_stat) encodes to value 32751, flags 8', () => {
    const { value, flags } = encode_effect_value(K_ALTER_STAT, -17, 0)
    expect(value).toBe(32751)
    expect(flags).toBe(FLAG_NEGATIVE) // FLAG_NEGATIVE === 8
  })

  test('Razkin: authored +25% (alter_resist) encodes to value 32793, flags 0', () => {
    const { value, flags } = encode_effect_value(K_ALTER_RESIST, 25, 0)
    expect(value).toBe(32793)
    expect(flags).toBe(0)
  })

  test('decode round-trip: both captured rows decode back to the exact authored delta', () => {
    expect(decode_status_value(K_ALTER_STAT, 32751)).toBe(-17)
    expect(decode_status_value(K_ALTER_RESIST, 32793)).toBe(25)
  })

  test('the retired magnitude+flag dialect would have emitted DIFFERENT bytes for both captures (the bug)', () => {
    // Math.abs(value) + authored flags verbatim — seed_full_corpus.mjs:361/370 and seed_spells_phase.mjs:107
    // before #1250. Ported here (not imported — both files have import-time chain side effects) to pin the
    // divergence forever, so it can never silently come back.
    const retired = (value, authored_flags = 0) => ({ value: Math.abs(value), flags: authored_flags })
    expect(retired(-17)).not.toEqual({ value: 32751, flags: FLAG_NEGATIVE })
    expect(retired(25)).not.toEqual({ value: 32793, flags: 0 })
    expect(retired(-17)).toEqual({ value: 17, flags: 0 })
  })

  test('a NON-signed kind is untouched by the centering — a plain magnitude, flags verbatim', () => {
    expect(encode_effect_value(K_DAMAGE, 42, 0)).toEqual({ value: 42, flags: 0 })
  })

  test('a NON-signed kind still gets the defensive abs() every corpus-facing site already relied on', () => {
    // seed_full_corpus.mjs / seed_spells_phase.mjs / reseed_plan.mjs unconditionally abs()'d every kind before
    // #1250; real corpus rows author a handful of negative non-signed values on purpose (e.g. K_CASTER_DAMAGE
    // "recoil" spells) — this helper preserves that pre-existing behavior untouched, in scope is ONLY the
    // signed-kind dialect fork.
    expect(encode_effect_value(K_DAMAGE, -12, 0)).toEqual({ value: 12, flags: 0 })
  })
})
