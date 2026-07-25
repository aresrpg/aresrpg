// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RULEBOOK MAY NOT OWN A NUMBER (#846). Every expectation below is COMPUTED from the module the game
// itself reads, never from a literal — so the only way these can fail is the page drifting from the rule.
// Rebalance a constant and the page follows; hand-type it back and this file goes red.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { MAX_MEMBERS } from '@aresrpg/party/reduce'
import sdk_classes from '@aresrpg/sdk/classes'
import { level_to_experience } from '@aresrpg/sdk/experience'
import { SPELL_POINTS_PER_LEVEL, STAT_POINTS_PER_LEVEL } from '@aresrpg/sdk/progression'
import { STATISTICS, get_total_stat } from '@aresrpg/sdk/stats'

import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import ja from '../../i18n/locales/ja.json'
import uk from '../../i18n/locales/uk.json'

import { GameplayTab } from './gameplay_tab'

const LOCALES = { en, fr, es, de, ja, uk } as Record<string, any>

// Provider-scoped only — a test instance never registers itself as react-i18next's global default (#833).
const EN_I18N = i18next.createInstance()
EN_I18N.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const render_rulebook = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <GameplayTab is_mobile={false} />
    </I18nextProvider>
  )

const visible_text = (html: string) => html.replace(/<[^>]+>/g, '')

describe('gameplay rulebook derives its numbers', () => {
  test('the per-level point grants are the SDK progression constants, interpolated', () => {
    const text = visible_text(render_rulebook())

    expect(text).toContain(`${STAT_POINTS_PER_LEVEL} per level`)
    expect(text).toContain(`${SPELL_POINTS_PER_LEVEL} per level`)
  })

  test('every locale interpolates the grant instead of spelling it — no hand-typed digit survives', () => {
    for (const [lng, bundle] of Object.entries(LOCALES)) {
      const { gameplay } = bundle.encyclopedia
      for (const key of ['stat_points_value', 'spell_points_value']) {
        expect(`${lng}.${key}:${gameplay[key]}`).toContain('{{n}}')
        expect(gameplay[key]).not.toMatch(/\d/)
      }
    }
  })

  test('base AP and MP come from the SDK empty-character derivation, not literals', () => {
    const text = visible_text(render_rulebook())

    expect(text).toContain(`${get_total_stat({} as any, STATISTICS.ACTION)} + equipment AP`)
    expect(text).toContain(`${get_total_stat({} as any, STATISTICS.MOVEMENT)} + equipment MP`)
  })

  test('the xp milestones are read off the SDK curve', () => {
    const text = visible_text(render_rulebook())

    for (const level of [10, 50, 100])
      expect(text).toContain(`${level_to_experience(level).toLocaleString('en-US')} XP`)
  })

  test('the party cap is the party reducer MAX_MEMBERS, in the row and in every locale sentence', () => {
    expect(render_rulebook()).toContain(`>${MAX_MEMBERS}</span>`)
    for (const [lng, bundle] of Object.entries(LOCALES)) {
      const { groups_desc } = bundle.encyclopedia.gameplay
      expect(`${lng}.groups_desc:${groups_desc}`).toContain('{{max}}')
      expect(groups_desc).not.toMatch(/\d/)
    }
  })

  test('the class table is @aresrpg/sdk/classes verbatim — identity, weapon and base HP', () => {
    const text = visible_text(render_rulebook())
    const classes = Object.values(sdk_classes as Record<string, any>)

    expect(classes.length).toBeGreaterThan(0)
    for (const row of classes) {
      const role = EN_I18N.t(`encyclopedia.gameplay.role_${row.title.toLowerCase()}`)
      const weapon = EN_I18N.t(`encyclopedia.gameplay.weapon_${row.weapon_category}`)
      expect(role).not.toContain('encyclopedia.')
      expect(weapon).not.toContain('encyclopedia.')
      expect(text).toContain(`${row.name}${role}${weapon}${row.health}`)
    }
  })
})

// packages/sim/src/fight_spells.js:279-282 (the cast.move:1385 `heal_caster` twin): the steal-back is gated on
// `caster.is_player && after_dmg.recipient_id === target_id` and takes half of `damage_dealt`, the health the
// victim ACTUALLY lost. The rulebook denied both conditions in all six locales until #846.
describe('gameplay rulebook life-steal prose matches the shipped gate', () => {
  const MOB_INCLUSION_CLAIM: Record<string, string> = {
    en: 'including mobs',
    fr: 'y compris les monstres',
    es: 'incluidos los mobs',
    de: 'auch Monster',
    ja: 'モブを含めて',
    uk: 'зокрема монстри',
  }

  test('no locale still claims a mob can life steal', () => {
    for (const [lng, bundle] of Object.entries(LOCALES)) {
      const { gameplay } = bundle.encyclopedia
      const prose = `${gameplay.life_steal_desc} ${gameplay.life_steal_note}`
      expect(`${lng}:${prose}`).not.toContain(MOB_INCLUSION_CLAIM[lng])
    }
  })

  test('the english page states the player-only gate and the actually-lost basis', () => {
    const text = visible_text(render_rulebook())

    expect(text).toContain('Only a player')
    expect(text).toContain('actually lose')
    expect(text).toContain('redirected')
    expect(text).not.toContain('half of the final damage dealt')
  })

  test('the formula box carries the caster gate instead of a bare halving', () => {
    const text = visible_text(render_rulebook())

    expect(text).toContain('casterIsPlayer ? floor(targetHealthLost / 2) : 0')
    expect(text).not.toContain('healed = floor(damageDealt / 2)')
  })
})
