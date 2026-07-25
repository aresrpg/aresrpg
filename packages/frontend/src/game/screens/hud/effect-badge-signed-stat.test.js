// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #886 RED-FIRST, end to end: the fighter nameplate read `-32793 Percent Damage · 1 turn` for a buff the
// corpus authors as +25% damage. This pins the WHOLE path the HUD actually walks — captured Fight.fx json →
// read_fighter_statuses (the wire door where the 32768 centering is stripped) → effect_badge_view → the exact
// localized line — so neither half can regress alone.
//
// The payload is the real minted effect of Razkin's self-buff (testnet MobTemplate
// 0x4a00a579a3ae4592310219ec550fba0c97ea0171a2bcdf38caa41b7aecdcbe97, `sui client object --json`, 2026-07-26:
// kind 9 · stat 8 · value "32793" · flags 0 · turns 2), wrapped in the Fight.fx.statuses shape the chain
// serves once that buff is live. Copy law (owner, #886): the reading uses the symbol '%', never the word.

import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { read_fighter_statuses } from '@aresrpg/fight/fight_status_snapshot'

import en from '../../../i18n/locales/en.json'
import { effect_badge_view } from './EffectBadges.jsx'

const i18n = i18next.createInstance()
i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const t = (key, params) => i18n.t(key, params)

/** The captured chain document for ONE live fighter status row. */
const fight_json = (effect, remaining_turns) => ({
  fx: { statuses: [{ fighter: '0', kind: effect.kind, remaining_turns, effect }] },
})

const razkin_percent_damage = { kind: '9', element: '255', value: '32793', stat: '8', chance: '100', flags: '0' }
const bonelet_agility = { kind: '9', element: '255', value: '32751', stat: '3', chance: '100', flags: '8' }

const line_of = (effect, turns) => effect_badge_view(t, read_fighter_statuses(fight_json(effect, turns))[0]).label

describe('fighter effect badges read the decoded chain magnitude (#886)', () => {
  test('RED-FIRST: the captured +25% damage buff renders "+25% Damage", not the raw biased int', () => {
    const label = line_of(razkin_percent_damage, '1')

    expect(label).toBe('+25% Damage · 1 turn')
    expect(label).not.toContain('32793')
    expect(label.toLowerCase()).not.toContain('percent') // the symbol, never the word
  })

  test('a captured debuff keeps its sign and its magnitude', () => {
    expect(line_of(bonelet_agility, '2')).toBe('-17 Agility · 2 turns')
  })
})
