// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 WP7 RED — ONE DISPLAY HP, TWO TRANSPORTS.
//
// The audit's high-severity HP class (project_views.js:282 · FightTimeline.jsx:150 · SpellBar.jsx:52 ·
// EntityTooltip.jsx:137): the projection offers THREE numbers for one fighter's health and each live surface
// picks a different one, so at the same instant the turn card and the HP gem render DIFFERENT hp for the SAME
// entity. Two transports carry the disagreement: the adopted chain SNAPSHOT (committed truth) and a local
// unacked INTENT (the presentation fold). At rest — nothing draining — the card takes committed and the gem
// takes the optimistic fold.
//
// This is driven, not asserted against a hand-copied expression: the card's number is READ OUT OF THE RENDERED
// DOM (renderToStaticMarkup, the FightTimeline.effective-deadline harness) and compared against the gem's own
// production view-model. One entity, one frame, one number — or the fight lies to the player about their life.

import { afterAll, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { fight_store } from '@aresrpg/fight/store'
import { fight_visible_view } from '@aresrpg/fight/project'

import { FightTimeline } from '../../../../src/game/screens/hud/FightTimeline.jsx'
import { self_vitals_view_model } from '../../../../src/game/screens/hud/self_vitals_view_model.js'
import { seed_fight_core, reset_fight_core } from '../../../../src/test_helpers/fight_core_harness.js'

const ME = '0xme'

// turn_order = [my seat, mob] → the FIRST hp-num match is my own card.
const card_hp_numbers = (html) => [...html.matchAll(/hud-turn__hp-num[^>]*>(\d+)</g)].map((m) => Number(m[1]))

afterAll(reset_fight_core) // the core is a process-wide singleton — leave no live fight for later files

describe('#1993 WP7 — one entity, one displayed HP, whatever surface renders it', () => {
  test('an unacked local Hit on MY seat cannot make the turn card and the HP gem disagree', () => {
    // TRANSPORT 1 — the adopted chain snapshot: my seat at 50 hp. Committed truth, nothing draining.
    seed_fight_core({ fight_id: '0xwp7a', my: ME, active: ME, turn_deadline_ms: Date.now() + 90_000 })

    // TRANSPORT 2 — a local, receipt-less intent that lands damage on MY OWN seat. It folds into the
    // presentation state and is deliberately excluded from committed truth until a receipt confirms it
    // (the door packages/fight/test/optimistic_hp.test.js locks).
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'Hit', victim_is_mob: false, victim_idx: 0, remaining_hp: 20 },
      version: 2,
      event_idx: 0,
    })

    const state = fight_store.getState()
    const row = fight_visible_view(state).entities[ME]
    expect(row, 'sanity: my seat has a canonical entity row').toBeTruthy()
    expect(row.vitals.committed, 'sanity: chain truth is untouched by an unacked intent').toBe(50)
    expect(row.vitals.presented, 'sanity: the presentation fold KNOWS the predicted hit').toBe(20)

    // THE CARD — driven through the real component, read out of the rendered markup.
    const [card_hp] = card_hp_numbers(renderToStaticMarkup(<FightTimeline />))
    // THE GEM — the production self-vitals view-model SpellBar's gem and the design harness both render.
    const gem_hp = self_vitals_view_model({ fighter: row }).health

    expect(card_hp, 'the card holds chain-anchored truth while the prediction is unconfirmed').toBe(50)
    expect(gem_hp, 'and the gem renders THE SAME number — one display HP, not two').toBe(card_hp)
    expect(gem_hp).toBe(row.vitals.display)
  })
})
