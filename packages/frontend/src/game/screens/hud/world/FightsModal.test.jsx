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

// #1316: a coop fight's join window used to close in silence — the JOIN button simply stopped rendering while
// the partner was still walking, and the row fell back to a bare phase word. The rule is unit-tested in
// @aresrpg/world (nearby_fights.test.js); this pins the WIRING — the row must read it and say so.
describe('FightsModal join-window notice (#1316)', () => {
  test('a fight that started without me names the closed window in place of the phase word', () => {
    expect(fights_modal_source).toContain('join_window_closed(marker, group_member)')
    expect(fights_modal_source).toContain("t('fights.join_window_closed')")
  })
})
