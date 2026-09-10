// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import StatsTab from '../../src/characters/StatsTab.tsx'
import SpellsTab from '../../src/characters/SpellsTab.tsx'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

const character: CharacterRow = {
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
  custody: 'kiosk',
  equipment: [],
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50000,
  z: 50000,
  at_ms: 0,
}
const set_activity = (activity: string): void => {
  const changes: Readonly<Record<string, Partial<CharacterRow>>> = {
    fight: { custody: 'fight' },
    seated: { active_fight: { id: '0xf', seat: 0 } },
    dungeon: { dungeon_run: { dungeon: 'temple', room: 2 }, at_ms: Date.now() + 3_153_600_000_000 },
    rooted: { at_ms: Date.now() + 60000 },
    ambush: { ambush: { protector: 'fuwa' } as CharacterRow['ambush'] },
  }
  dispatch_app({ type: 'world/gather_failed', character_id: character.id, attempt_id: 'probe' })
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [{ ...character, ...changes[activity] }] },
  })
  if (activity === 'gather')
    dispatch_app({
      type: 'world/gather_started',
      gathering: {
        attempt_id: 'probe',
        character_id: character.id,
        item_type: 'wheat',
        protector: 'fuwa',
        started_at_ms: Date.now(),
        duration_ms: 60000,
        ends_at_ms: Date.now() + 60000,
        confirmed: false,
        authoritative: false,
        ambushed: false,
        quantity: null,
      },
    })
}
const Fixture = () => {
  const [copy, set_copy] = useState<AppCopy | null>(null)
  const [calls, set_calls] = useState(0)
  const row = useAppStore(({ session }) => session.characters[0])
  useEffect(() => {
    const record = async () => {
      set_calls((count) => count + 1)
    }
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({
      type: 'auth/connected',
      session: {
        address: 'fixture',
        character: { raise_stats: record, raise_spell: record },
      } as unknown as AuthSession,
    })
    set_activity(new URLSearchParams(location.search).get('state') ?? 'idle')
    void load_app_copy('en').then(set_copy).catch(console.error)
  }, [])
  if (!copy || !row) return null
  return (
    <main className="bg-bg p-4 text-text">
      <div className="flex gap-4">
        <button onClick={() => set_activity('fight')}>Enter fight</button>
        <button onClick={() => set_activity('idle')}>Become idle</button>
        <button
          onClick={() =>
            document.addEventListener('click', () => queueMicrotask(() => set_activity('fight')), {
              capture: true,
              once: true,
            })
          }
        >
          Fight on next click
        </button>
        <output data-calls="">{calls}</output>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <StatsTab character={row} copy={copy} />
        <SpellsTab character={row} copy={copy} />
      </div>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
