// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEARCH-ZONE JUICE — i18n RUNTIME proof for the zone-reveal banner strings. The i18n coverage gate only
// checks that keys RESOLVE; this pins the actual rendered output: the plural base+_one+_other wiring picks
// the right form per count, and {{count}}/{{zx}}/{{zy}} interpolate. Uses a standalone i18next instance (no
// browser LanguageDetector) so it runs headless. en (2-form plural), fr (2-form), ja (no plural) covered.
import { test, expect } from 'bun:test'
import { createInstance } from 'i18next'

import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'

const inst = (lng, resources) => {
  const i = createInstance()
  i.init({ lng, fallbackLng: 'en', resources, interpolation: { escapeValue: false } })
  return i
}
const EN = inst('en', { en: { translation: en } })
const FR = inst('fr', { fr: { translation: fr } })
const JA = inst('ja', { ja: { translation: ja } })

test('en: reveal counts pick singular vs plural, and interpolate the number', () => {
  expect(EN.t('discovery.reveal_mobs', { count: 1 })).toBe('1 mob group')
  expect(EN.t('discovery.reveal_mobs', { count: 3 })).toBe('3 mob groups')
  expect(EN.t('discovery.reveal_nodes', { count: 1 })).toBe('1 resource node')
  expect(EN.t('discovery.reveal_nodes', { count: 2 })).toBe('2 resource nodes')
})

test('en: title, coords interpolation, and the empty-zone line', () => {
  expect(EN.t('discovery.zone_revealed')).toBe('Zone revealed')
  expect(EN.t('discovery.zone_coords', { zx: 3, zy: 7 })).toBe('Sector 3 · 7')
  expect(EN.t('discovery.reveal_empty')).toBe('The zone lies quiet')
})

test('fr: plural agreement holds in a second locale', () => {
  expect(FR.t('discovery.reveal_mobs', { count: 1 })).toBe('1 groupe de monstres')
  expect(FR.t('discovery.reveal_mobs', { count: 4 })).toBe('4 groupes de monstres')
})

test('ja: no plural distinction — the ×count form renders for any count', () => {
  expect(JA.t('discovery.reveal_mobs', { count: 1 })).toBe('モンスターの群れ ×1')
  expect(JA.t('discovery.reveal_mobs', { count: 5 })).toBe('モンスターの群れ ×5')
  expect(JA.t('discovery.reveal_nodes', { count: 2 })).toBe('資源ノード ×2')
})
