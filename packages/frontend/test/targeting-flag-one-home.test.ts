// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1249 — the targeting-flag bits (TF_NOT_ENEMY / TF_ONLY_CASTER) have exactly ONE home:
// packages/sim/src/spell_effect.js, reached from the frontend through the sim's own export map
// (@aresrpg/sim/spell_effect). This fixture pins the frontend's ally-targeting preview
// (spell-category.js's buff classification, seed-effect-line.js's target label) to the SAME bit
// the sim's own targeting resolver (`effect_hits`, spell_targeting.js) treats as "hits an ally" —
// so a re-declared, renamed, or inverted local copy in either frontend file is caught the instant
// it drifts from canon, instead of silently shipping a mis-previewed ally spell.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { TF_NOT_ENEMY, TF_ONLY_CASTER } from '@aresrpg/sim/spell_effect'
import { effect_hits } from '@aresrpg/sim/spell_targeting'

import { seed_effect_line } from '../src/game/screens/hud/seed-effect-line.js'
import { spell_category } from '../src/game/screens/hud/spell-category.js'
import en from '../src/i18n/locales/en.json'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
const t = i18n.t.bind(i18n)

describe('#1249 targeting-flag bits — one home', () => {
  test('spell-category buff preview agrees with the sim resolver on the ally bit (TF_NOT_ENEMY)', () => {
    // Ground truth from the sim's OWN targeting resolver: TF_NOT_ENEMY alone hits a same-team
    // fighter and never an opposing one — this is what "ally-targeting" means on-chain.
    expect(effect_hits(TF_NOT_ENEMY, false, true)).toBe(true) // ally: hit
    expect(effect_hits(TF_NOT_ENEMY, false, false)).toBe(false) // enemy: excluded

    const ally_targeted = spell_category({
      effects: [
        { kind: 'ALTER_STAT', element: 'neutral', target_filter: TF_NOT_ENEMY },
      ],
    })
    expect(ally_targeted.family).toBe('buff')

    // An identical effect with no friendly bit set is never previewed as a buff.
    const enemy_targeted = spell_category({
      effects: [{ kind: 'ALTER_STAT', element: 'neutral', target_filter: 1 }],
    })
    expect(enemy_targeted.family).toBe('utility')
  })

  test('spell-category buff preview agrees with the sim resolver on the self bit (TF_ONLY_CASTER)', () => {
    expect(effect_hits(TF_ONLY_CASTER, true, true)).toBe(true) // caster: hit
    expect(effect_hits(TF_ONLY_CASTER, false, true)).toBe(false) // ally, not caster: excluded

    const self_targeted = spell_category({
      effects: [
        { kind: 'ALTER_RESIST', element: 'neutral', target_filter: TF_ONLY_CASTER },
      ],
    })
    expect(self_targeted.family).toBe('buff')
  })

  test('seed-effect-line names the same ally bit the sim resolver hits', () => {
    const ally_line = seed_effect_line(t, {
      kind: 'GIVE_POINTS',
      stat: 0,
      base: 1,
      chance: 10,
      turns: 0,
      target_filter: TF_NOT_ENEMY,
    })
    expect(ally_line).toContain('Ally')
    expect(effect_hits(TF_NOT_ENEMY, false, true)).toBe(true)
  })
})
