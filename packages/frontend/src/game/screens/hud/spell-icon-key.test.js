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

import { describe, expect, test } from 'bun:test'
import { configure_walrus_assets, reset_walrus_assets_for_test, spell_icon_url } from '@aresrpg/sdk/jobs'

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
    reset_walrus_assets_for_test()
    configure_walrus_assets({ aggregator: HOST, classes: { spell: { published: true } } })
    const [spell] = build_fight_spells([corpus_row()]).spells

    expect(spell_icon_url(spell.icon_key)).toBe(`${HOST}/spells/rojin_greed.webp`)
    reset_walrus_assets_for_test()
  })
})
