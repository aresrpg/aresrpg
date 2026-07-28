// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE INERT-KIND SENTINEL — the effect vocabulary the sim declares but cannot fold (#1039).
//
// `K_RESET_POSITIONS` (18) is declared on both sides of the twin — `spell_effect.js` exports it and
// `spell_effect.move:44` mints the same number — and neither side has an arm for it: the normalizer degrades it
// to `UNSUPPORTED`, so a spell authored with it folds NOTHING. (`K_REMOVE_STATE` (23) left this set when both
// twins gained their clear-the-named-state arm.)
//
// That fact already has two consumers, each of which TRUSTS it rather than checking it:
//   • `effect_kind_matrix.test.js` flags its row `unsupported: true` and asserts it folds nothing;
//   • `seeded_spell_effect_conformance.test.js` quarantines its contract row behind `skip_reason`.
// Neither pins the SET. A third kind could be flagged or quarantined tomorrow and nothing would say so, which
// is the failure mode of every gate whose own subject is unmeasured (#956 / #1020 / #908 are the same class).
//
// This file is that missing pin, and it derives the set from the NORMALIZER rather than restating it: the two
// consumers above are then checked against ground truth instead of against a comment. Wiring either kind — the
// work #1039 actually asks for — turns this red and names both pins to flip in the same commit.

import { describe, expect, test } from 'bun:test'

import * as SE from '../src/spell_effect.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

import { matrix_rows } from './seeded_spell_effect_conformance_matrix.js'

/** Every `K_*` discriminant the vocabulary declares, deduplicated and ordered. */
const ALL_KINDS = [
  ...new Set(
    Object.entries(SE)
      .filter(
        ([name, value]) => name.startsWith('K_') && typeof value === 'number',
      )
      .map(([, value]) => value),
  ),
].toSorted((a, b) => a - b)

const kind_name = kind =>
  Object.entries(SE).find(
    ([name, value]) => name.startsWith('K_') && value === kind,
  )?.[0] ?? `K_${kind}`

/** GROUND TRUTH: push one authored effect of `kind` through the real normalizer and report whether it survived
 *  as a foldable row. `UNSUPPORTED` is the normalizer's own terminal for "no arm for this kind" — it is loud on
 *  stderr as it mints one, which is why the two lines this run prints are expected output, not noise. */
const folds = kind => {
  const spell_id = `inert_probe_${kind}`
  const templates = normalize_spell_templates([
    {
      id: spell_id,
      levels: [
        {
          ap_cost: 1,
          range_min: 0,
          range_max: 5,
          effects: [
            {
              kind,
              value: 7,
              element: 0,
              target_filter: SE.TF_NOT_TEAM,
              chance: 100,
              turns: 2,
            },
          ],
          crit_effects: [],
        },
      ],
    },
  ])
  return (
    templates.get(spell_id).levels[0].base_effects[0].type !== 'UNSUPPORTED'
  )
}

const INERT = ALL_KINDS.filter(kind => !folds(kind))

describe('the inert effect kinds are exactly the two the board knows about', () => {
  test('the normalizer degrades K_RESET_POSITIONS, and nothing else, to UNSUPPORTED', () => {
    expect(INERT.map(kind_name)).toEqual(['K_RESET_POSITIONS'])
    // wiring the last arm makes this list empty — flip `unsupported: true` in effect_kind_matrix.test.js and
    // drop the matching `skip_reason` in seeded_spell_effect_conformance_matrix.js in the SAME commit (#1039)
    expect(ALL_KINDS.length - INERT.length).toBe(39)
  })

  test('the seeded conformance matrix quarantines exactly the inert kinds — no more, no fewer', () => {
    const quarantined = matrix_rows
      .filter(row => row.skip_reason !== undefined)
      .map(row => row.kind)
    expect(quarantined.toSorted((a, b) => a - b).map(kind_name)).toEqual(
      INERT.map(kind_name),
    )
    // …and every quarantine names the row it is waiting on, so a skipped contract is never an orphan
    for (const row of matrix_rows.filter(r => r.skip_reason !== undefined))
      expect({
        kind: kind_name(row.kind),
        cites_issue: /#\d+/.test(row.skip_reason),
      }).toEqual({
        kind: kind_name(row.kind),
        cites_issue: true,
      })
  })
})
