// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import sdk_classes from '../../../sdk/src/classes.json'
import { get_class } from '../game/data/classes.js'
import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ja from '../i18n/locales/ja.json'
import uk from '../i18n/locales/uk.json'

import { CLASSES } from './simulator'

const SANCTIONED_TITLES = {
  SENSHI: 'Warrior',
  YAJIN: 'Assassin',
  IKARI: 'Berserker',
  MORI: 'Druid',
  TOKEI: 'Chronomancer',
  SHUGO: 'Guardian',
  YOGEN: 'Archer',
  ROJIN: 'Prospector',
  SHUSEN: 'Brawler',
  // SPEC §3 still says Summoner while §7 removes summons. The live label uses the task-sanctioned neutral identity.
  TOMODA: 'Tomoda',
  ASOBI: 'Gambler',
  IYASHI: 'Healer',
} as const

const LOCALES = { de, en, es, fr, ja, uk }

describe('class identity labels', () => {
  test('the twelve simulator and SDK identities match the sanctioned roster', () => {
    expect(Object.fromEntries(CLASSES.map(({ id, title }) => [id, title]))).toEqual(SANCTIONED_TITLES)
    expect(Object.fromEntries(Object.values(sdk_classes).map(({ id, title }) => [id.toUpperCase(), title]))).toEqual(
      SANCTIONED_TITLES
    )
    expect(get_class('tomoda')?.title).toBe('Tomoda')
  })

  test('all six locale maps cover twelve classes without the stale identities', () => {
    for (const locale of Object.values(LOCALES)) {
      const { classes } = locale.simulator
      expect(Object.keys(classes)).toEqual(Object.keys(SANCTIONED_TITLES))
      expect(classes.TOMODA.title).toBe('Tomoda')
      expect(locale.encyclopedia.gameplay.role_tomoda).toBe('Tomoda')
      expect(Object.values(classes).map(({ title }) => title)).not.toContain('Summoner')
      expect(Object.values(classes).map(({ title }) => title)).not.toContain('Necromancer')
    }
  })
})
