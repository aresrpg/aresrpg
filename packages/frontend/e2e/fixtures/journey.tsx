// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { JOURNEY_QUESTS } from '../../src/journey/model.ts'
import { JourneyHost } from '../../src/journey/JourneyHost.tsx'
import { JourneyTracker } from '../../src/journey/JourneyPanel.tsx'
import { JourneySettings } from '../../src/journey/JourneySettings.tsx'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { dispatch_app, observe_app, read_app_state, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

const character: CharacterRow = {
  id: 'hero',
  name: 'Adventurer',
  classe: 'senshi',
  sex: 'male',
  level: 10,
  experience: '0',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  available_spell_points: 0,
  spells: {},
  jobs: {},
  kiosk: 'kiosk',
  equipment: [],
  world: 'nauvis',
  custody: 'kiosk',
}
const give = (item_type: string): void => {
  const { item } = content_catalog.item(item_type)!
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory',
      items: [
        {
          id: item_type,
          item_type,
          name: item.name,
          category: item.category,
          level: item.level,
          amount: 1,
          kiosk: 'kiosk',
        },
      ],
    },
  })
}
const harvest = (): void => {
  dispatch_app({
    type: 'world/gather_started',
    gathering: {
      attempt_id: 'harvest',
      character_id: 'hero',
      item_type: 'wheat',
      protector: '',
      started_at_ms: 0,
      duration_ms: 1,
      ends_at_ms: 1,
      confirmed: false,
      authoritative: false,
      ambushed: false,
      quantity: null,
    },
  })
  dispatch_app({
    type: 'world/gather_confirmed',
    attempt_id: 'harvest',
    character_id: 'hero',
    fallback_ends_at_ms: 1,
    ambushed: false,
    quantity: 1,
  })
}
const Fixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const path = useAppStore((state) => state.navigation.pathname)
  const completion = useAppStore((state) => state.journey.completed)
  return (
    <main className="min-h-screen bg-bg p-4 font-mono text-text">
      <nav className="mb-4 flex flex-wrap gap-3 text-xs">
        <button onClick={() => give('old_hoe')} type="button">
          Receive hoe
        </button>
        <button onClick={() => give('wheat')} type="button">
          Buy wheat
        </button>
        <button
          onClick={() => {
            const { identity, generation } = read_app_state().journey
            dispatch_app({
              type: 'journey/loaded',
              identity: identity!,
              generation,
              completed: JOURNEY_QUESTS.map(({ id }) => id),
            })
          }}
          type="button"
        >
          Load completed journey
        </button>
        <button onClick={harvest} type="button">
          Harvest wheat
        </button>
      </nav>
      <div className="max-w-3xl">
        <JourneySettings copy={copy} />
      </div>
      <div className="mt-6">
        <JourneyTracker copy={copy} />
      </div>
      <JourneyHost copy={copy} />
      <output data-completion="" className="mt-8 block text-xs">
        {JSON.stringify(completion)}
      </output>
      <output data-path="" className="block text-xs">
        {path}
      </output>
    </main>
  )
}
const requested = new URLSearchParams(location.search)
const locale = LOCALES.find(({ code }) => code === requested.get('locale'))?.code ?? 'en'
void load_app_copy(locale)
  .then((copy) => {
    dispatch_app({ type: 'locale/changed', locale })
    dispatch_app({ type: 'locale/loaded', locale, copy })
    dispatch_app({
      type: 'settings/changed',
      settings: { ...read_app_state().settings, completed_tutorials: [] },
    })
    // Arm before login, as game_entry does; only the session owns account selection.
    observe_app(['journey'])
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({
      type: 'auth/connected',
      session: { address: requested.get('account') ?? 'journey-test-a' } as AuthSession,
    })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
    dispatch_app({ type: 'character/select', character_id: character.id })
    createRoot(document.getElementById('root')!).render(<Fixture copy={copy} />)
  })
  .catch((error: unknown) => console.error('Journey fixture failed.', error))
