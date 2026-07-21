// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRIT-IN-THE-FIGURE (#163) — owner ruling: "if it's a critical hit then show it directly in the (−X) in bold,
// do not show a second line for criticals, it's deterministic" + the crit number highlighted orange. So the
// board-hover card's head damage figure carries the WHOLE story: a deterministic crit paints the (−X) with the
// bold-orange `ent-tt__delta--crit` modifier, and the old "CRITICAL n% → −X" second line is GONE from the DOM.
// TooltipCard is a pure-props shell (`t` rides in), so renderToStaticMarkup asserts the markup with no store/DOM
// graph (FightReport/ItemIcon precedent — no jsdom in this repo).

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipCard } from './tooltip_card.jsx'

const t = (key) => key // stub — any surviving crit second line would render its raw i18n key, which we assert is gone

// A RESOLVED crit outcome as predicted_target_outcome now yields: the pending cast crits, dropping the mob 8→2
// (a −6 hit). `is_crit` is the resolved fact; the legacy `.crit`/`crit_chance` fields are supplied too so this
// same fixture renders the OLD second line under the pre-fix component (the red-first proof), and is ignored after.
const base_props = { team: 1, style: {}, exiting: false, name: 'Razkin', shown_hp: 8, displacement: null, effects: [], t }
const crit_outcome = { remaining_hp: 2, delta: -6, kills: false, displaced_to: null, crit: { delta: -6, kills: false } }
const render_crit = (is_crit) =>
  renderToStaticMarkup(<TooltipCard {...base_props} outcome={crit_outcome} is_crit={is_crit} crit_chance={3.33} />)

describe('TooltipCard — the deterministic crit shows IN the damage figure (owner: no second line)', () => {
  test('a crit outcome paints the (−X) with the bold-orange crit modifier — the number IS the crit tell', () => {
    const html = render_crit(true)
    expect(html).toContain('ent-tt__delta--crit') // the head figure gains the orange/bold crit class
    expect(html).toContain('−6') // and shows the exact resolved (crit) magnitude
  })

  test('NO second CRITICAL line survives in the DOM — the head figure carries the whole story', () => {
    const html = render_crit(true)
    expect(html).not.toContain('ent-tt__crit"') // the old crit-line element class is gone
    expect(html).not.toContain('predicted_crit') // ...and its i18n key never renders anywhere
  })

  test('a NON-crit outcome keeps the plain red (−X) — no crit modifier', () => {
    const html = render_crit(false)
    expect(html).toContain('ent-tt__delta--dmg')
    expect(html).not.toContain('ent-tt__delta--crit')
  })
})
