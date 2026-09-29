// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { item_stat_center, stat_names } from '@aresrpg/immutable'

import type { AuthSession } from '../../src/auth.ts'
import { TUTORIAL_IDS } from '../../src/tutorial/tutorial.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initialize_app_store, dispatch_app } from '../../src/store.ts'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { MobileApp } from '../../../mobile/src/MobileApp.tsx'
import '../../src/tailwind.css'
import '../../../mobile/src/mobile.css'

const character: CharacterRow = {
  id: '0xchar',
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 1,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 10,
  wisdom: 0,
  strength: 5,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 12,
  spells: {},
  available_spell_points: 9,
  jobs: {},
  kiosk: '0xkiosk',
  custody: new URLSearchParams(location.search).has('locked') ? 'fight' : 'kiosk',
  equipment: [],
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50000,
  z: 50000,
  at_ms: 0,
}
initialize_app_store({
  quality: 'low',

  music_enabled: false,
  render_distance: null,
  completed_tutorials: TUTORIAL_IDS,
})
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
document.body.dataset.writes = '0'
const record = async (): Promise<void> => {
  document.body.dataset.writes = String(Number(document.body.dataset.writes) + 1)
}
dispatch_app({
  type: 'auth/connected',
  session: {
    address: 'fixture',
    character: { raise_stats: record, raise_spell: record, equip: record, craft: record, scribe_rune: record },
  } as unknown as AuthSession,
})
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
dispatch_app({ type: 'character/select', character_id: character.id })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/server_info',
    online: 1,
    indexing_lag: 0,
    current_epoch: '1',
    chain_timestamp_ms: Date.now(),
    chain_sample_age_ms: 0,
  },
})
const inventory: ItemRow[] = ['hat', 'resource', 'rune', 'consumable']
  .flatMap((category) => encyclopedia_catalog.items.filter((item) => item.category === category).slice(0, 8))
  .map((item, index) => ({
    id: `0xitem${index}`,
    item_type: item.item_type,
    name: item.name,
    category: item.category,
    level: item.level,
    amount: 1,
    kiosk: character.kiosk,
    stats: Object.fromEntries(stat_names.map((stat) => [stat, item_stat_center + (item.stats?.max[stat] ?? 0)])),
  })) as ItemRow[]
dispatch_app({
  type: 'server/packet',
  packet: { type: 'packet/inventory', items: new URLSearchParams(location.search).has('empty') ? [] : inventory },
})
// This runs the actual player canvas owner and mobile shell; only network/GPU observers are absent.
createRoot(document.getElementById('root')!).render(<MobileApp />)
