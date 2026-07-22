// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n PARITY GUARD — the stats.description.* bundle (the one-line "what this stat actually does" copy under
// each CHARACTERISTICS row — packages/frontend/src/game/screens/hud/Stats.jsx). The 6-locale law (CLAUDE.md):
// every user-facing string lands in ALL locales; a missing/empty locale would print the raw key. This pins
// presence + non-emptiness across all six, mechanically, for every stat row the panel renders: the six
// allocatable primaries plus the two visible secondaries (Critical Hit, Raw Damage — SECONDARY_KEYS in
// Stats.jsx excludes every other equipment-only stat). Every key was RED before the feature landed.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

// Exactly the keys Stats.jsx's PRIMARY array + SECONDARY_KEYS allow-list render a row for.
const KEYS = ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility', 'critical_hit', 'raw_damage']

const ENGLISH_TRUTH = {
  vitality: 'Increases your max HP',
  wisdom: 'Increases your XP gain',
  strength: 'Increases your earth damage',
  intelligence: 'Increases your fire damage and healing',
  chance: 'Increases your water damage and loot drop chance',
  agility: 'Increases your air damage, tackle, and dodge of AP/MP loss',
  critical_hit: 'Improves your odds of landing a critical hit',
  raw_damage: 'Adds a flat amount to damage and life-steal effects',
}

const CORRECTED_KEYS = ['wisdom', 'strength', 'chance', 'agility', 'raw_damage']
const CORRECTED_COPY = {
  en: {
    wisdom: 'Increases your XP gain',
    strength: 'Increases your earth damage',
    chance: 'Increases your water damage and loot drop chance',
    agility: 'Increases your air damage, tackle, and dodge of AP/MP loss',
    raw_damage: 'Adds a flat amount to damage and life-steal effects',
  },
  fr: {
    wisdom: 'Augmente votre gain d’XP',
    strength: 'Augmente vos dégâts Terre',
    chance: 'Augmente vos dégâts Eau et vos chances d’obtenir du butin',
    agility: 'Augmente vos dégâts Air, votre tacle et votre esquive de perte de PA/PM',
    raw_damage: 'Ajoute un montant fixe aux effets de dégâts et de vol de vie',
  },
  de: {
    wisdom: 'Erhöht deinen XP-Gewinn',
    strength: 'Erhöht deinen Erdschaden',
    chance: 'Erhöht deinen Wasserschaden und deine Beutechance',
    agility: 'Erhöht deinen Luftschaden, deine Fesselung und dein Ausweichen bei AP/BP-Verlust',
    raw_damage: 'Fügt Schadens- und Lebensraub-Effekten einen festen Wert hinzu',
  },
  es: {
    wisdom: 'Aumenta tu ganancia de XP',
    strength: 'Aumenta tu daño de Tierra',
    chance: 'Aumenta tu daño de Agua y la probabilidad de obtener botín',
    agility: 'Aumenta tu daño de Aire, placaje y esquiva de pérdida de PA/PM',
    raw_damage: 'Añade una cantidad fija a los efectos de daño y robo de vida',
  },
  ja: {
    wisdom: '獲得経験値が増加する',
    strength: '土属性ダメージが増加する',
    chance: '水属性ダメージとアイテムのドロップ率が増加する',
    agility: '風属性ダメージ、足止め、AP/MPロスの回避が増加する',
    raw_damage: 'ダメージ効果とライフスティール効果に固定値を追加する',
  },
  uk: {
    wisdom: 'Збільшує отримання досвіду',
    strength: 'Збільшує шкоду від землі',
    chance: 'Збільшує шкоду від води та шанс отримання здобичі',
    agility: 'Збільшує шкоду від повітря, захоплення та ухилення від втрати ОД/ОР',
    raw_damage: 'Додає фіксоване значення до ефектів шкоди та викрадення життя',
  },
}

const read_descriptions = async (lang) => {
  const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
  return json?.stats?.description
}

describe('i18n · stats.description.* present + non-empty in ALL 6 locales', () => {
  for (const key of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty stats.description.${key}`, async (lang) => {
      const value = (await read_descriptions(lang))?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }
})

describe('i18n · stats.description.* matches the audited mechanics', () => {
  test('English states the complete formula-backed contract for every visible stat', async () => {
    expect(await read_descriptions('en')).toEqual(ENGLISH_TRUTH)
  })

  test.each(LOCALES)('%s.json carries every corrected claim', async (lang) => {
    const descriptions = await read_descriptions(lang)
    expect(Object.fromEntries(CORRECTED_KEYS.map((key) => [key, descriptions?.[key]]))).toEqual(CORRECTED_COPY[lang])
  })
})
