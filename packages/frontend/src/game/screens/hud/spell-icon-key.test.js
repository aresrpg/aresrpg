// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #884 RED-FIRST — the fight hotbar rendered key caps and AP costs but no spell art. Not a preview-env
// artifact: the client asked the asset host for `/spells/<name_key>.<ext>` while every uploaded spell icon is
// keyed by the corpus row's own id (`<class>_<name>`). This file pins the KEY half; the EXTENSION half (the
// store serves `.webp`, single-size) is pinned once in packages/sdk/test/spell_icon_webp.test.js.
//
// CAPTURED PROBE (live asset host, 2026-07-26 — the discriminator, one spell whose two candidate keys differ):
//   GET https://assets.aresrpg.world/spells/rojin_greed.webp → 200   (corpus id `rojin_greed`, name "Greed")
//   GET https://assets.aresrpg.world/spells/greed.webp       → 404   (name_key `greed`)
// Corroborated by the content house's own upload manifest: all 240 icons resident, every key in the id shape.

import { afterEach, describe, expect, test } from 'bun:test'
import { configure_assets, item_icon_url, reset_assets_for_test, spell_icon_url } from '@aresrpg/sdk/jobs'

import { spell_card } from '../../core/modules/fight.js'
import { set_spell_corpus_for_test } from '../../data/spell_corpus.js'
import { build_fight_spells } from './fight-spells-core.js'

const HOST = 'https://icon-key.example'

const corpus_row = () => ({
  id: 'rojin_greed',
  classType: 'rojin',
  name: 'Greed',
  unlock: 1,
  levels: [{ min_char_level: 1, ap_cost: 3, range_min: 1, range_max: 4, effects: [] }],
})

describe('spell art resolves by the corpus id, not the display name key (#884)', () => {
  test('RED-FIRST: the projected icon key is the corpus id — `greed` resolves to nothing on the host', () => {
    const [spell] = build_fight_spells([corpus_row()]).spells

    expect(spell.icon_key).toBe('rojin_greed')
    expect(spell.name_key).toBe('greed') // the display/selection identity is unchanged
  })

  test('the resolved URL is the one that answers 200 on the asset host', () => {
    reset_assets_for_test()
    configure_assets({ aggregator: HOST, classes: { spell: { published: true } } })
    const [spell] = build_fight_spells([corpus_row()]).spells

    expect(spell_icon_url(spell.icon_key)).toBe(`${HOST}/spells/rojin_greed.webp`)
    reset_assets_for_test()
  })
})

// Issue #1041 RED-FIRST — the SAME wrong-key class one id-space over. A hand card names its corpus row by
// whichever id the surface that dealt it uses: the world deals `name_key`s, the local-chain surface deals the
// SpellTemplate OBJECT ID itself (#1025 — fight_start.js `cast_id_of`, fight_setup.js `hand_update_of`). The
// resolver indexed name_keys ONLY, so an object-id card fell through to the neutral card, which handed the raw
// id back as its icon — and `spell_icon_url` (unlike `item_icon_url`, which throws on a `0x…`) happily built
// `spells/0x….webp`, one 404 per socket per render. The cure is one index over all three id spaces, so every
// icon surface keeps reading the ONE `icon_key` fight-spells-core already resolves.
// Shortened on purpose — the hardcoded-chain-id gate bans the full 0x+64-hex shape in source, and neither the
// resolver nor the 404 it used to mint reads the length: `spells/<anything 0x>.webp` is the whole bug.
const OBJECT_ID = '0xc4b8e1d6a3057c9e'

test('spell_icon_url has the same case-insensitive object-id tripwire as item_icon_url (#1072)', () => {
  const uppercase_prefix_object_id = `0X${'25'.repeat(32)}`

  expect(() => item_icon_url(uppercase_prefix_object_id)).toThrow('object id')
  expect(() => spell_icon_url(uppercase_prefix_object_id)).toThrow('object id')
})

afterEach(() => {
  set_spell_corpus_for_test()
  reset_assets_for_test()
})

describe('a hand card named by its SpellTemplate object id resolves the same art (#1041)', () => {
  test('RED-FIRST: spell_card(<object id>) carries the corpus-id art key, never the object id', () => {
    set_spell_corpus_for_test([{ ...corpus_row(), object_id: OBJECT_ID }])

    const card = spell_card(OBJECT_ID)

    expect(card.icon).toBe('rojin_greed')
    expect(card.name).toBe('Greed') // the raw id never leaks as a player-facing name either (D14)
    // the other two id spaces name the same row, so every surface still gets the same art key
    expect(spell_card('greed').icon).toBe('rojin_greed') // name_key — the world's hand
    expect(spell_card('rojin_greed').icon).toBe('rojin_greed') // corpus template_id
  })

  test('the socket therefore requests the URL that answers 200, not `spells/<object id>.webp`', () => {
    configure_assets({ aggregator: HOST, classes: { spell: { published: true } } })
    set_spell_corpus_for_test([{ ...corpus_row(), object_id: OBJECT_ID }])

    expect(spell_icon_url(spell_card(OBJECT_ID).icon)).toBe(`${HOST}/spells/rojin_greed.webp`)
  })

  test('an id no corpus row names (a mob/cosmetic cast) carries NO art key — a guess can only 404', () => {
    set_spell_corpus_for_test([{ ...corpus_row(), object_id: OBJECT_ID }])

    expect(spell_card('mob_spell_alley_bunny_0').icon).toBeNull()
    expect(spell_icon_url(spell_card('mob_spell_alley_bunny_0').icon)).toBeNull()
  })
})
