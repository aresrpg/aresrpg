// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// unsupported_kind_is_loud.test.js — THE SILENCE TRIPWIRE (#952).
//
// A template carries several effects, so ONE unmapped kind inside an otherwise-healthy spell used to vanish
// without a trace: the spell cast, folded its other effects, and quietly did less than it says. That silence is
// what let this whole class hide — the per-template "at least one supported effect" measurement is blind to it.
// The live 240-spell corpus currently normalizes with ZERO unsupported rows, so this costs nothing today and
// screams the day a new kind lands unmapped.

import { describe, expect, test } from 'bun:test'

import { normalize_spell_templates } from '../src/spell_templates.js'

/** Run `fn`, capturing everything it writes to console.error. */
const captured = fn => {
  const lines = []
  const original = console.error
  console.error = (...args) => lines.push(args.join(' '))
  try {
    fn()
  } finally {
    console.error = original
  }
  return lines
}

const spell = (id, effects) => ({
  id,
  levels: [
    {
      ap_cost: 3,
      range_min: 0,
      range_max: 8,
      effects,
      crit_effects: [],
    },
  ],
})

describe('an unmapped effect kind is LOUD, never silent (#952)', () => {
  test("authored haki's taunt kind aborts normalization (#998)", () => {
    expect(() =>
      normalize_spell_templates([
        spell('haki', [
          { type: 'taunt', target: 'enemies', chance: 100, turns: 1 },
        ]),
      ]),
    ).toThrow(/spell 'haki'.*effect kind taunt.*no fold arm/)
  })

  test('an unknown NUMERIC kind names the spell and the kind', () => {
    const lines = captured(() =>
      normalize_spell_templates([
        spell('mystery_bolt', [{ kind: 250, value: 4, chance: 100 }]),
      ]),
    )
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('mystery_bolt')
    expect(lines[0]).toContain('250')
  })

  test('the healthy sibling effects of that same spell still normalize', () => {
    const templates =
      captured(() => {}) &&
      normalize_spell_templates([
        spell('half_good', [
          { kind: 0, element: 0, value: 9, chance: 100 },
          { kind: 250, value: 4, chance: 100 },
        ]),
      ])
    const effects = templates.get('half_good').levels[0].base_effects
    expect(effects.map(e => e.type)).toEqual(['DAMAGE', 'UNSUPPORTED'])
  })

  test('a fully-supported spell says NOTHING', () => {
    const lines = captured(() =>
      normalize_spell_templates([
        spell('clean_bolt', [{ kind: 0, element: 0, value: 12, chance: 100 }]),
      ]),
    )
    expect(lines).toEqual([])
  })
})
