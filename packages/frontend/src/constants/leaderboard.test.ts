import { describe, expect, test } from 'bun:test'

import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ja from '../i18n/locales/ja.json'
import uk from '../i18n/locales/uk.json'

import { ALLTIME_ONLY_CATEGORIES, CATEGORY_KEYS, LEADERBOARD_CATEGORIES } from './leaderboard'

const LOCALES = [en, fr, de, es, ja, uk]

describe('leaderboard categories', () => {
  test('exposes only live ranking categories', () => {
    expect(LEADERBOARD_CATEGORIES).toEqual(['XP', 'KILLS', 'TIME_PLAYED', 'DUNGEONS', 'SUI_SPENT', 'JOBS'])
    expect(CATEGORY_KEYS).toEqual({
      XP: 'xp',
      KILLS: 'kills',
      TIME_PLAYED: 'time_played',
      DUNGEONS: 'dungeons',
      SUI_SPENT: 'sui_spent',
      JOBS: 'jobs',
    })
    expect([...ALLTIME_ONLY_CATEGORIES]).toEqual(['TIME_PLAYED', 'DUNGEONS', 'SUI_SPENT', 'JOBS'])
    for (const locale of LOCALES) {
      expect(locale.leaderboard).not.toHaveProperty('kares')
      for (const category of LEADERBOARD_CATEGORIES)
        expect(locale.leaderboard[category.toLowerCase() as keyof typeof locale.leaderboard]).toBeTruthy()
    }
  })
})
