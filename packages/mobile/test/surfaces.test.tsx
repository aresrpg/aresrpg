// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CharacterRow } from '@aresrpg/protocol'

import { load_app_copy } from '../../frontend/src/i18n/copy.ts'
import { initialize_app_store, dispatch_app } from '../../frontend/src/store.ts'
import StatsPanel from '../../frontend/src/characters/StatsTab.tsx'
import InventoryPanel from '../../frontend/src/characters/EquipmentTab.tsx'
import SpellsPanel from '../../frontend/src/characters/SpellsTab.tsx'
import JobsPanel from '../../frontend/src/characters/JobsTab.tsx'
import ForgePanel from '../../frontend/src/characters/RuneforgeTab.tsx'
import SettingsPanel from '../../frontend/src/settings/SettingsPage.tsx'
import MarketPanel from '../../frontend/src/marketplace/MarketplacePage.tsx'
import EncyclopediaPanel from '../../frontend/src/encyclopedia/EncyclopediaPage.tsx'
import { Login } from '../../frontend/src/components/Login.tsx'
import { MobileApp } from '../src/MobileApp.tsx'
import { TouchControls } from '../src/TouchControls.tsx'
import { InventoryItemCell } from '../../frontend/src/characters/InventoryItemCell.tsx'

const settings = { quality: 'low', music_enabled: false, render_distance: null } as const
const character = {
  id: 'sample',
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  level: 1,
  experience: '0',
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 10,
  available_spell_points: 4,
  spells: {},
  jobs: {},
  equipment: [],
  kiosk: 'kiosk',
  custody: 'fight',
  at_ms: 0,
} as unknown as CharacterRow
afterEach(() => initialize_app_store(settings))

test('mobile management renders a read-only character without a signing session', async () => {
  const copy = await load_app_copy('en')
  initialize_app_store({ ...settings, marketplace_disclaimer_acknowledged: true })
  dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
  for (const Component of [StatsPanel, InventoryPanel, SpellsPanel, JobsPanel, ForgePanel]) {
    const html = renderToStaticMarkup(<Component character={character} copy={copy} />)
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('NaN')
  }
  const stats = renderToStaticMarkup(<StatsPanel character={character} copy={copy} />)
  expect(stats).toContain('disabled=""')
  const forge = renderToStaticMarkup(<ForgePanel character={character} copy={copy} />)
  expect(forge).toContain('disabled=""')
  expect(renderToStaticMarkup(<MarketPanel copy={copy} locale="en" />)).toContain('Before you trade')
  expect(renderToStaticMarkup(<SettingsPanel copy={copy} settings={settings} />)).toContain('Day/night cycle')
  expect(
    renderToStaticMarkup(<EncyclopediaPanel copy={copy} pathname="/encyclopedia/items" navigate={() => {}} />)
  ).toMatch(/search items/i)
})

test('mobile login and touch controls expose explicit actions without executing them during render', async () => {
  const copy = await load_app_copy('en')
  initialize_app_store(settings)
  dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
  let calls = 0
  const record = (): void => {
    calls += 1
  }
  const login = renderToStaticMarkup(
    <Login
      copy={copy}
      auth_ready={false}
      login_google={record}
      login_wallet={record}
      wallets={[]}
      show_wallets={false}
      set_show_wallets={record}
      gift={false}
    />
  )
  expect(login).toContain('/play-demo')
  expect(renderToStaticMarkup(<TouchControls copy={copy} />)).toContain('aria-label="Move"')
  expect(
    renderToStaticMarkup(
      <InventoryItemCell
        item={{
          id: 'item',
          name: 'Test item',
          item_type: 'wheat',
          category: 'resource',
          level: 1,
          amount: 2,
          kiosk: 'kiosk',
        }}
        amount={2}
        aria-pressed={false}
        onClick={record}
      />
    )
  ).toContain('×2')
  expect(renderToStaticMarkup(<MobileApp />)).not.toContain('Continue with Google')
  expect(calls).toBe(0)
})
