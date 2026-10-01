// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import { ConsumeHealingModal } from '../../src/characters/ConsumeHealingModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { read_app_state, type AppState } from '../../src/store.ts'

test('healing choices are localized and unavailable inventory cannot be consumed', async () => {
  const character = { level: 1, vitality: 0, kiosk: 'kiosk', hp: '1', hp_ms: Date.now() } as CharacterRow
  const item = {
    id: 'missing',
    item_type: 'barley_bread',
    name: 'Barley Bread',
    category: 'consumable',
    amount: 3,
    kiosk: 'kiosk',
  } as ItemRow
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    const markup = renderToStaticMarkup(
      <ConsumeHealingModal
        character={character}
        item={item}
        copy={copy}
        close={() => {}}
        confirm={() => {
          throw new Error('Rendering must not consume items')
        }}
      />
    )
    expect(markup).toContain(String(copy.characters_page.consume_one))
    expect(markup).toContain(String(copy.characters_page.max))
    expect(markup.match(/disabled=""/g)).toHaveLength(2)
    expect(markup).not.toContain('{{')
  }
})

test('maximum healing stays enabled when available stock cannot fill HP', async () => {
  const character = { level: 1, vitality: 0, kiosk: 'kiosk', hp: '1', hp_ms: Date.now() } as CharacterRow
  const item = {
    id: 'bread',
    item_type: 'barley_bread',
    name: 'Bread',
    category: 'consumable',
    amount: 1,
    kiosk: 'kiosk',
  } as ItemRow
  const copy = await load_app_copy('en')
  const current = read_app_state()
  const state = { ...current, copy, session: { ...current.session, inventory: [item] } }
  const reader = spyOn(zustand, 'useStore').mockImplementation(((
    _store: unknown,
    selector: (state: AppState) => unknown
  ) => selector(state)) as typeof zustand.useStore)
  try {
    const markup = renderToStaticMarkup(
      <ConsumeHealingModal character={character} item={item} copy={copy} close={() => {}} confirm={() => {}} />
    )
    expect(markup).not.toContain('disabled=""')
    expect(markup).toContain('Max')
    expect(markup).toContain('×1')
    expect(markup).not.toContain('Not enough items')
  } finally {
    reader.mockRestore()
  }
})
