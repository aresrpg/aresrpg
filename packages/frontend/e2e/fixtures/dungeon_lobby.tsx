// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import type { CharacterRow, DungeonLobbyFightRow } from '@aresrpg/protocol'

import { DungeonLobby } from '../../src/components/DungeonLobby.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, initialize_app_store, observe_app, read_app_state } from '../../src/store.ts'
import '../../src/tailwind.css'

declare global {
  interface Window {
    dungeon_starts: readonly number[]
  }
}

const { dungeon } = content_catalog.dungeons[0]!
const character = {
  id: '0xself',
  name: 'Explorer',
  classe: 'senshi',
  level: 10,
  custody: 'kiosk',
  kiosk: '0xk',
  world: 'nauvis',
  dungeon_run: { dungeon, room: 1 },
  equipment: [],
} as unknown as CharacterRow
const fight = (id: string, name: string, opener: string, access: number): DungeonLobbyFightRow => ({
  id,
  room: 1,
  phase: 'placement',
  access,
  opener,
  players: [{ character_id: opener, name, level: 10, room: 1 }],
})
initialize_app_store({
  quality: 'medium',
  flat_mode: false,
  music_enabled: false,
  render_distance: null,
  fight_access: 0,
})
window.dungeon_starts = []
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: {
    address: '0xowner',
    dungeon: {
      start_fight: async ({ access }: { access: number }) => {
        window.dungeon_starts = [...window.dungeon_starts, access]
        return { fight: '0xnew' }
      },
    },
  } as never,
})
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
dispatch_app({ type: 'character/select', character_id: character.id })
if (!new URLSearchParams(location.search).has('solo'))
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/party',
      character_id: character.id,
      party: {
        id: '0xparty',
        members: [
          { character_id: character.id, name: character.name },
          { character_id: '0xfriend', name: 'Friend' },
        ],
        invited: [],
      },
    },
  })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/dungeon_lobby',
    lobby: {
      dungeon,
      players: [],
      fights: [
        fight('0xpublic', 'Public players', '0xstranger', 0),
        fight('0xown', 'Our party', '0xfriend', 1),
        fight('0xexternal', 'External party', '0xexternal', 1),
      ],
    },
  },
})
observe_app(['dungeon'])
void load_app_copy('en')
  .then((copy) => {
    dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
    createRoot(document.getElementById('root')!).render(
      <>
        <button
          className="fixed top-0 right-0 z-50"
          onClick={() =>
            dispatch_app({
              type: 'settings/changed',
              settings: { ...read_app_state().settings, fight_access: 1 },
            })
          }
        >
          Set navbar group preference
        </button>
        <DungeonLobby copy={copy} />
      </>
    )
  })
  .catch(console.error)
