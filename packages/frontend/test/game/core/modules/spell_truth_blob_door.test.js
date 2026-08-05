// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE SPELL-TRUTH DOOR (#2220) — sealed against real served bytes.
//
// `spell_templates()` (game/core/modules/fight.js) is what the fight module and the deck HUD resolve casts,
// previews and spell detail through. Its corpus comes from ONE place and may never come from anywhere else:
// the served blob (`corpus_version` pointer → `spell_corpus.<version>.json`) cached by data/spell_corpus.js
// and decoded by @aresrpg/sim's `normalize_chain_spell_corpus` through fight-spells' single door. The sdk's
// generated `spells.json` was a second home feeding exactly this function; it is deleted, and the class gate
// keeping it dead lives in packages/sdk/test/spell_truth_one_home.test.js.
//
// PROVENANCE: the rows below are the REAL served payload — 5 complete rows captured 2026-08-01 from
// https://assets.aresrpg.world/data/spell_corpus.20260801a.json (sha256 in the fixture's `_doc`), byte-faithful
// except `object_id`, mechanically rewritten for the repo's chain-id gate. Tests never fetch live.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { normalize_chain_spell_corpus } from '@aresrpg/sim/chain_spell_corpus'

import { set_spell_corpus_for_test } from '../../../../src/game/data/spell_corpus.js'
import { fight_spells_data } from '../../../../src/game/screens/hud/fight-spells.js'
import { mint_authored_spell } from '../../../../src/game/screens/hud/fight-spells-core.js'
import { spell_templates } from '../../../../src/game/core/modules/fight.js'
import CAPTURED from '../../../fixtures/spell-corpus-20260801a.sample.json'

const ROWS = CAPTURED.rows

describe('spell truth reaches the fight module from the served corpus alone', () => {
  beforeEach(() => set_spell_corpus_for_test(ROWS))
  afterEach(() => set_spell_corpus_for_test())

  test('every served row resolves by BOTH the armed name_key and the corpus template_id', () => {
    expect(ROWS.length).toBeGreaterThan(0) // the captured payload was actually read
    const templates = spell_templates()

    expect(fight_spells_data.spells.map(({ template_id }) => template_id).sort()).toEqual(
      ROWS.map(({ id }) => id).sort()
    )
    for (const spell of fight_spells_data.spells) {
      expect(templates.get(spell.template_id)).toBe(spell.template)
      expect(templates.get(spell.name_key)).toBe(spell.template)
    }
  })

  // ONE decode path: the map the fight module reads is exactly what the sim's chain-corpus door produces from
  // the same bytes — never a second normalization living on the client side of the seam.
  test('the resolved template is the sim chain-corpus decode of the same served bytes, verbatim', () => {
    const expected = normalize_chain_spell_corpus(ROWS.map(mint_authored_spell))
    const templates = spell_templates()

    for (const { id } of ROWS) expect(templates.get(id)).toEqual(expected.get(id))
    // a punishment spell whose effects the legacy corpus never carried — it resolves because the BLOB carries it
    expect(templates.get('ikari_blood_toll')?.levels.length).toBeGreaterThan(0)
  })

  // The anti-legacy arm: with no blob loaded there is NOTHING to fall back on. A bundled corpus re-entering the
  // tree would make this map non-empty and fail here.
  test('with no served corpus the door resolves NOTHING — there is no bundled fallback', () => {
    set_spell_corpus_for_test()

    expect(fight_spells_data.spells).toEqual([])
    expect(spell_templates().size).toBe(0)
  })
})
