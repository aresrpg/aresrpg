// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { item_stat_center } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import EquipmentTab from '../../src/characters/EquipmentTab.tsx'
import RuneforgeTab from '../../src/characters/RuneforgeTab.tsx'
import { CrushResultDialog } from '../../src/characters/CrushResultModal.tsx'
import { Toasts } from '../../src/components/Toasts.tsx'
import { content_catalog, encyclopedia_catalog } from '../../src/content/catalog.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import type { AuthSession } from '../../src/auth.ts'
import { dispatch_app, read_app_state, useAppStore } from '../../src/store.ts'

import { inventory_agent_fixture } from './inventory_agent.ts'
import '../../src/tailwind.css'
import '../../src/components/character_surfaces.css'
import '../../src/characters/characters.css'

declare global {
  interface Window {
    equip_requests: readonly unknown[]
    resolve_equip: () => void
    reject_equip: () => void
    consume_requests: readonly string[]
    feed_requests: readonly Readonly<{ pet_id: string; food_id: string }>[]
    resolve_feed: () => void
    reject_feed: () => void
    played_audio: string[]
  }
}

// Simulated custody and inventory; only the real inventory page and reducers run, with no observers or signer.
const character: CharacterRow = {
  id: '0xcharacter',
  name: 'Inventory tester',
  classe: 'senshi',
  sex: 'male',
  level: 10,
  experience: '0',
  color_1: 0xffffff,
  color_2: 0xffffff,
  color_3: 0xffffff,
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
  kiosk: '0xkiosk',
  custody: 'kiosk',
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  at_ms: 0,
  hp: '1',
  hp_ms: Date.now(),
  equipment: [],
}
const item_types = new URLSearchParams(location.search).has('crowded')
  ? content_catalog.items.filter(({ category }) => category === 'resource').map(({ item_type }) => item_type)
  : [
      'scroll_of_oblivion',
      'scroll_of_rebirth',
      'croissant',
      'siluri',
      'gilded_pet_food',
      'recall_potion',
      'potion_of_thebes',
      'rune_vitality_ba',
      'gnawed_branch',
      'wheat',
      'wheat',
      'wheat_flour',
      'key_of_tangled_aftermath',
    ]
const items: ItemRow[] = item_types.map((item_type, index) => {
  const seed = encyclopedia_catalog.item(item_type)!.item
  return {
    id: `0xitem${index}`,
    version: '1',
    item_type,
    name: seed.name,
    category: seed.category,
    level: seed.level,
    amount: 2,
    ...(seed.category === 'pet' ? { pet_power: 30, pet_last_day: 0, stats: { wisdom: item_stat_center + 80 } } : {}),
    kiosk: character.kiosk,
  }
})
const equipped_character = new URLSearchParams(location.search).has('equipped')
  ? { ...character, equipment: [{ ...items.find(({ item_type }) => item_type === 'siluri')!, slot: 'pet' as const }] }
  : character
const requested = new URLSearchParams(location.search).get('locale')
const locale = LOCALES.find(({ code }) => code === requested)?.code ?? 'en'
void load_app_copy(locale)
  .then((copy) => {
    dispatch_app({ type: 'locale/changed', locale })
    dispatch_app({ type: 'locale/loaded', locale, copy })
    window.equip_requests = []
    window.feed_requests = []
    window.consume_requests = []
    const agent = new URLSearchParams(location.search).has('agent')
      ? inventory_agent_fixture(items, new URLSearchParams(location.search).has('agent-fail'))
      : null
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({
      type: 'auth/connected',
      session: {
        address: '0xowner',
        ...agent?.wallet,
        character: {
          equip: async (request: unknown) => {
            window.equip_requests = [...window.equip_requests, request]
            if (new URLSearchParams(location.search).has('pending-equip')) {
              const pending = Promise.withResolvers<void>()
              window.resolve_equip = () => pending.resolve()
              window.reject_equip = () => pending.reject(new Error('Equipment rejected'))
              await pending.promise
            }
          },
          use_consumable: async ({ item_type }: { item_type: string }) => {
            window.consume_requests = [...window.consume_requests, item_type]
            return { inventory_changes: [] }
          },
          feed_pet: async (request: Readonly<{ pet_id: string; food_id: string }>) => {
            const pending = Promise.withResolvers<void>()
            window.feed_requests = [...window.feed_requests, request]
            window.resolve_feed = () => pending.resolve()
            window.reject_feed = () => pending.reject(new Error('Feeding rejected'))
            await pending.promise
            const food = items.find(({ id }) => id === request.food_id)!
            return {
              digest: 'feed-receipt',
              inventory_changes: [{ id: food.id, amount: food.amount - 1, version: '2' }],
            }
          },
        },
      } as unknown as AuthSession,
    })
    if (agent)
      dispatch_app({ type: 'agent/inventory_target', wallet: read_app_state().session.wallet!, pairing: agent.pairing })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [equipped_character] } })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items } })
    const Inventory = () => {
      const current = useAppStore((state) => state.session.characters.find(({ id }) => id === character.id))!
      const [shown, set_shown] = useState(true)
      return (
        <>
          <button onClick={() => set_shown(!shown)}>{shown ? 'Close inventory' : 'Open inventory'}</button>
          {shown && <EquipmentTab character={current} copy={copy} />}
        </>
      )
    }
    createRoot(document.getElementById('root')!).render(
      <main className="h-dvh overflow-y-auto bg-bg p-6 font-mono text-text">
        <button
          onClick={() =>
            dispatch_app({
              type: 'server/packet',
              packet: {
                type: 'packet/characters',
                characters: [
                  {
                    ...equipped_character,
                    dungeon_run: { dungeon: 'temple', room: 2 },
                    at_ms: Date.now() + 3_153_600_000_000,
                  },
                ],
              },
            })
          }
        >
          Enter dungeon
        </button>
        <button
          onClick={() =>
            dispatch_app({
              type: 'server/packet',
              packet: { type: 'packet/characters', characters: [equipped_character] },
            })
          }
        >
          Leave dungeon
        </button>
        <button
          onClick={() =>
            document.addEventListener(
              'dblclick',
              () =>
                queueMicrotask(() =>
                  dispatch_app({
                    type: 'server/packet',
                    packet: {
                      type: 'packet/characters',
                      characters: [
                        {
                          ...equipped_character,
                          dungeon_run: { dungeon: 'temple', room: 2 },
                          at_ms: Date.now() + 3_153_600_000_000,
                        },
                      ],
                    },
                  })
                ),
              { once: true, capture: true }
            )
          }
        >
          Dungeon on next use
        </button>
        {new URLSearchParams(location.search).get('view') === 'forge' ? (
          <RuneforgeTab character={equipped_character} copy={copy} />
        ) : (
          <div
            className="game-character-body"
            style={new URLSearchParams(location.search).has('crowded') ? { width: 880, height: 600 } : undefined}
          >
            <Inventory />
          </div>
        )}
        {new URLSearchParams(location.search).get('view') === 'crush' && (
          <CrushResultDialog
            close={() => undefined}
            copy={copy}
            result={{
              digest: 'fixture',
              items: items.filter(({ category }) => category === 'rune'),
              received_amounts: { rune_vitality_ba: 1 },
            }}
          />
        )}
        <Toasts />
      </main>
    )
  })
  .catch((error: unknown) => console.error('Inventory fixture failed.', error))
