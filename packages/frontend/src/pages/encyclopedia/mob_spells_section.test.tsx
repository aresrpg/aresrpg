// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'

import { mob_spell_views } from './mob_spells'
import { MobSpellCard, MobSpellsSection } from './mob_spells_section'

const EN_I18N = i18next.createInstance()
EN_I18N.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

test('each authored spell renders as a REAL card — named header + AP + its effect lines, inline (not hover-only)', () => {
  const spells = mob_spell_views([
    {
      ap: 3,
      rmin: 1,
      rmax: 5,
      cd: 2,
      crit: 20,
      effects: [{ kind: 0, op: 'damage', element: 'earth', base: 10 }],
      crit_effects: [{ kind: 0, op: 'damage', element: 'earth', base: 18 }],
    },
    { effects: [{ kind: 14, op: 'teleport' }] },
  ])
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <MobSpellsSection spells={spells} />
    </I18nextProvider>
  )
  expect(html).toContain('SPELLS')
  // design ruling 2026-07-19: a REAL spell card, not a bare "1 earth damage" line — each spell is its own titled card…
  expect(html).toContain('data-spell-card="1"')
  expect(html).toContain('data-spell-card="2"')
  // …carrying its NAME inline (the hover-only card left the row a bare line before). SPELL {{n}}.
  expect(html).toContain('SPELL 1')
  expect(html).toContain('SPELL 2')
  // the shared seed_effect_parts grammar: value 10 + "Earth damage" with the crit meta riding the line
  expect(html).toContain('>10</b>')
  expect(html).toContain('Earth damage')
  expect(html).toContain('crit 18')
  expect(html).toContain('Teleport')
  // per-card AP cost with the localized short AP token (stat.action)
  expect(html).toContain('3 AP')
})

test('an empty kit renders no section at all (honest gap, never an empty shell)', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <MobSpellsSection spells={[]} />
    </I18nextProvider>
  )
  expect(html).toBe('')
})

test('a bestiary spell carries the corpus range-modifiability verdict through the shared spell caption', () => {
  const [extendable, fixed] = mob_spell_views([
    {
      ap: 3,
      rmin: 1,
      rmax: 5,
      mod: true,
      effects: [{ kind: 0, op: 'damage', element: 'earth', base: 10 }],
    },
    {
      ap: 4,
      rmin: 1,
      rmax: 2,
      mod: false,
      effects: [{ kind: 0, op: 'damage', element: 'fire', base: 8 }],
    },
  ])

  expect(extendable.modifiable_range).toBe(true)
  expect(fixed.modifiable_range).toBe(false)

  const render_card = (spell: typeof extendable) =>
    renderToStaticMarkup(
      <I18nextProvider i18n={EN_I18N}>
        <MobSpellCard spell={spell} index={0} />
      </I18nextProvider>
    )

  const extendable_html = render_card(extendable)
  const fixed_html = render_card(fixed)
  expect(extendable_html).toContain('RANGE MODIFIABILITY')
  expect(extendable_html).toContain('+RANGE STAT EXTENDS THIS')
  expect(fixed_html).toContain('FIXED — +RANGE STAT DOES NOT APPLY')
})
