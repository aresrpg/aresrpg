// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import { ConsumeHealingModal } from '../../src/characters/ConsumeHealingModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

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
    expect(markup).toContain(String(copy.characters_page.consume_until_full))
    expect(markup.match(/disabled=""/g)).toHaveLength(2)
    expect(markup).not.toContain('{{')
  }
})
