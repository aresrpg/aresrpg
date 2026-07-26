// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

import { seed_effect_line } from '../src/game/screens/hud/seed-effect-line.js'
import de from '../src/i18n/locales/de.json'
import en from '../src/i18n/locales/en.json'
import es from '../src/i18n/locales/es.json'
import fr from '../src/i18n/locales/fr.json'
import ja from '../src/i18n/locales/ja.json'
import uk from '../src/i18n/locales/uk.json'

const locale_rows = [
  ['de', de, 'Selbst', 'Verbündeter'],
  ['en', en, 'Self', 'Ally'],
  ['es', es, 'Uno mismo', 'Aliado'],
  ['fr', fr, 'Soi', 'Allié'],
  ['ja', ja, '自身', '味方'],
  ['uk', uk, 'На себе', 'Союзник'],
] as const

const translator_for = (locale: string, resources: object) => {
  const i18n = i18next.createInstance()
  i18n.init({
    lng: locale,
    resources: { [locale]: { translation: resources } },
    interpolation: { escapeValue: false },
  })
  return i18n.t.bind(i18n)
}

const point_effect = {
  kind: 'GIVE_POINTS',
  stat: 0,
  base: 1,
  chance: 10,
  turns: 0,
}

describe('#1058 spell-effect target labels', () => {
  test.each(locale_rows)(
    '%s names self and ally targets while enemy remains implicit',
    (locale, resources, self, ally) => {
      const t = translator_for(locale, resources)
      const self_line = seed_effect_line(t, { ...point_effect, target_filter: 32 })
      const ally_line = seed_effect_line(t, { ...point_effect, target_filter: 4 })
      const enemy_line = seed_effect_line(t, { ...point_effect, target_filter: 1 })

      expect(self_line).toContain(self)
      expect(ally_line).toContain(ally)
      expect(enemy_line).not.toContain(self)
      expect(enemy_line).not.toContain(ally)
      expect(self_line).toContain('10%')
    }
  )
})
