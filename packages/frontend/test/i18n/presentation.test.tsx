// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, expect, test } from 'bun:test'
import { CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'

import { dispatch_app } from '../../src/store.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { ItemDetailView } from '../../src/components/ItemDetailView.tsx'
import { EquipmentDoll } from '../../src/components/EquipmentDoll.tsx'
import { SpellCard } from '../../src/encyclopedia/SpellCard.tsx'
import { spell_effect_text } from '../../src/encyclopedia/spell_effect_text.ts'
import type { SpellEffect } from '../../src/content/catalog.ts'

import { render_current_state as renderToStaticMarkup } from './render.ts'

const effect: SpellEffect = {
  kind: Number(EFFECT_KINDS.add),
  element: '',
  stat: Number(CHANNELS.strength),
  value: 2,
  value_max: 4,
  area_shape: 0,
  area_size: 0,
  turns: 2,
  chance_bp: 10_000,
  target_filter: Number(TARGET_FILTERS.not_enemy),
}
const select_french = async () => {
  const copy = await load_app_copy('fr')
  dispatch_app({ type: 'locale/changed', locale: 'fr' })
  dispatch_app({ type: 'locale/loaded', locale: 'fr', copy })
  return copy
}
afterEach(async () => {
  dispatch_app({ type: 'locale/changed', locale: 'en' })
  dispatch_app({ type: 'locale/loaded', locale: 'en', copy: await load_app_copy('en') })
})

test('French item details and empty equipment slots translate categories, stats, elements and numbered relics', async () => {
  await select_french()
  const html = renderToStaticMarkup(
    <ItemDetailView
      category="sword"
      item_type="audit"
      level={1}
      name="Audit"
      damages={[{ element: 'earth', from: 1, to: 3, damage_type: 'weapon' }]}
      stats={{ min: { strength: 1 }, max: { strength: 3 } }}
      labels={{ characteristics: '', damages: '', level_short: '', range_to: 'à' }}
    />
  )
  expect(html).toContain('Épée')
  expect(html).toContain('Force')
  expect(html).toContain('Terre')
  expect(html).not.toContain('Strength')
  const doll = renderToStaticMarkup(<EquipmentDoll item_for={() => null} open={() => undefined} />)
  expect(doll).toContain('Relique 1')
  expect(doll).toContain('Bottes')
})

test('effect sentences preserve localized word order and generated target meanings', async () => {
  const german = copy_text(await load_app_copy('de'))
  const view = spell_effect_text(effect, german)
  expect(`${view.pre}${view.value}${view.post}`).toBe('Erhöht Stärke um 2 bis 4')
  expect(view.meta).toContain('Nur Verbündete')
  const others = spell_effect_text({ ...effect, target_filter: Number(TARGET_FILTERS.not_self) }, german)
  expect(others.meta).toContain('Nur andere')
})

test('combat-style small spell cards use the selected locale without a translator prop', async () => {
  await select_french()
  const html = renderToStaticMarkup(
    <SpellCard
      small
      spell={{
        name: 'Audit',
        classe: 'senshi',
        unlock_level: 1,
        levels: [
          {
            ap_cost: 2,
            range_min: 1,
            range_max: 2,
            modifiable_range: false,
            line_of_sight: true,
            line_launch: false,
            free_cell: false,
            casts_per_turn: 0,
            casts_per_target: 0,
            cooldown_turns: 0,
            crit_1_in: 50,
            effects: [effect],
            crit_effects: [],
          },
        ],
      }}
    />
  )
  expect(html).toContain('Ajoute')
  expect(html).toContain('Force')
  expect(html).toContain('Alliés uniquement')
  expect(html).not.toContain('Adds')
  expect(html).not.toContain('>Effects<')
})
