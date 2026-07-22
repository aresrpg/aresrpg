// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const fights_modal_source = readFileSync(new URL('./FightsModal.jsx', import.meta.url), 'utf8')

// #498: FightHoverCard used to hardcode t('fight_end.your_party') for every hovered fight, including public
// ones with zero viewer characters seated. The pure gate is unit-tested in fight_area_panel.test.js; this
// pins the WIRING — the component must actually call it and fall back to the neutral label.
describe('FightsModal hover-card party label (#498)', () => {
  test('gates the player-side title on viewer_has_fighter instead of a hardcoded Your party', () => {
    expect(fights_modal_source).toContain('viewer_has_fighter(teams.players, my_character_ids)')
    expect(fights_modal_source).toContain("t('fights.fighters_label')")
    expect(fights_modal_source).not.toContain("<FightTeam title={t('fight_end.your_party')}")
  })
})
