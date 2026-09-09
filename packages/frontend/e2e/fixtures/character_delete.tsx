// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { CharacterTabs } from '../../src/components/CharacterTabs.tsx'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

// Only the real UI and reducers run. This wallet records intent without any chain access.
const character = (overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id: '0xchar',
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 10,
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
  equipment: [],
  ...overrides,
})

const rows = [character(), character({ id: 'second', name: 'Ash' })]
const Fixture = () => {
  const [copy, set_copy] = useState<AppCopy | null>(null)
  const [calls, set_calls] = useState<readonly string[]>([])
  const state = useAppStore((state) => state.session)
  const wallet = useMemo(
    () =>
      ({
        address: 'fixture',
        character: {
          delete: async ({ character_id }: { character_id: string }) => {
            set_calls((calls) => [...calls, character_id])
            await new Promise((resolve) => setTimeout(resolve, 350))
            if (new URLSearchParams(location.search).has('fail')) throw new Error('Deletion refused by chain')
            return { digest: 'fixture-deleted' }
          },
        },
      }) as unknown as AuthSession,
    []
  )
  useEffect(() => {
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({ type: 'auth/connected', session: wallet })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: rows } })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/game_state', frozen: false } })
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/server_info',
        online: 1,
        indexing_lag: 0,
        current_epoch: '3',
        chain_timestamp_ms: 1_000_000,
      },
    })
    void load_app_copy('en').then(set_copy).catch(console.error)
  }, [wallet])
  if (!copy) return null
  return (
    <main className="min-h-screen bg-bg p-12 text-text">
      <CharacterTabs
        characters={state.characters}
        copy={copy}
        create_character={() => undefined}
        select_character={(character_id) => dispatch_app({ type: 'character/select', character_id })}
        selected_character_id={state.selected_character_id}
      />
      <output data-calls="">{JSON.stringify(calls)}</output>
      <button
        onClick={() => dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: rows } })}
      >
        Stale roster
      </button>
      <button
        onClick={() =>
          dispatch_app({
            type: 'server/packet',
            packet: {
              type: 'packet/characters',
              characters: [character({ equipment: [{ slot: 'cosmetic_hat' } as never] }), rows[1]!],
            },
          })
        }
      >
        Equip cosmetic
      </button>
      <button onClick={() => dispatch_app({ type: 'auth/disconnected' })}>Disconnect</button>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
