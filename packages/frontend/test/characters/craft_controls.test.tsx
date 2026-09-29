// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import { CraftControls } from '../../src/characters/CraftControls.tsx'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { adventure_character_row } from '../../src/adventure/projection.ts'
import { adventure_character } from '../../src/adventure/character.ts'
import { copy_text, type AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { read_app_state, type AppState } from '../../src/store.ts'

test('local ingredient projections cannot enable a chain craft even with a connected wallet', () => {
  const recipe = encyclopedia_catalog.recipes[0]!
  const character = adventure_character_row(adventure_character())
  const inventory = Object.entries(recipe.inputs).map(([item_type, amount]) => ({
    id: item_type,
    item_type,
    amount,
    category: 'resource',
    name: item_type,
    level: 1,
    kiosk: character.kiosk,
  }))
  const current = read_app_state()
  // This SSR probe reads wallet presence only; it never invokes wallet methods.
  const state = { ...current, copy: en, session: { ...current.session, inventory, wallet: {} } } as unknown as AppState
  const reader = spyOn(zustand, 'useStore').mockImplementation(((
    _store: unknown,
    selector: (state: AppState) => unknown
  ) => selector(state)) as typeof zustand.useStore)
  const render = (local: boolean) =>
    renderToStaticMarkup(
      <CraftControls
        recipe={recipe}
        character={character}
        inventory_override={local ? inventory : undefined}
        job="FARMER"
        level={100}
        t={copy_text((en as AppCopy).characters_page)}
        open_ingredient={() => undefined}
      />
    ).match(/<button[^>]*class="[^"]*jobs__craft-btn[^"]*"[^>]*>/)![0]
  try {
    expect(render(false)).not.toContain('disabled=""')
    expect(render(true)).toContain('disabled=""')
  } finally {
    reader.mockRestore()
  }
})
