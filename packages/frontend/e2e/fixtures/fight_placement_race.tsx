// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { create_character_source, create_fight, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'

import { catalog_spell_sources } from '../../src/content/fight_sources.ts'
import type { AuthSession } from '../../src/auth.ts'
import type { FightResourceLoader } from '../../src/game/fight/fight_resources.ts'
import { FightLayer } from '../../src/game/fight/FightLayer.tsx'
import type { SceneHandle } from '../../src/game/core/scene_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, useAppStore, type AppInput, start_app } from '../../src/store.ts'
import { all_modules } from '../support/app.ts'
import '../../src/tailwind.css'

start_app(all_modules({ observe: ['fight', 'fight_chain'] }), { seat: true })

// Real fight reducers, observers and React UI; GPU presentation and chain execution are isolated.
const resource_loader: FightResourceLoader = {
  characters: async () => [],
  prepare: async () => {},
}
const picking = { cell: null as number | null }
const scene: SceneHandle = {
  get canvas() {
    return document.querySelector('canvas')!
  },
  show_fight_board: () => {},
  set_entities: () => {},
  set_nearby_entities: () => {},
  set_entity_caption: () => {},
  animate_entity: async () => false,
  prepare_fight_effects: async () => {},
  prepare_fight_cue: async (cue) => cue,
  play_fight_cue: async () => false,
  project_entity: () => null,
  create_fight_blob: () => 'blob',
  update_fight_blob: () => false,
  remove_fight_blob: () => {},
  pick_fight_cell: () => picking.cell,
  ground_height: () => 0,
  set_quality: () => {},
}
const row = (id: string, name: string): CharacterRow => ({
  id,
  name,
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 1,
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
  equipment: [],
  kiosk: 'kiosk',
  world: 'nauvis',
  custody: 'fight',
  active_fight: { id: 'placement-race', seat: 0 },
})
const push = (checkpoint: HydratedFightCheckpoint): void =>
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/fight_state',
      fight: checkpoint.contract.id,
      state: { contract: checkpoint.contract, players: checkpoint.sources.players },
      seat: 0,
    },
  } as unknown as AppInput)

const RosterCount = () => (
  <output aria-label="Participants">
    {useAppStore((state) => state.fight.checkpoint?.contract.fighters.length ?? 0)}
  </output>
)

const boot = async (): Promise<void> => {
  const copy = await load_app_copy('en')
  dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
  const chain = create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      fight_id: 'placement-race',
      world: 'nauvis',
      board_seed: 17n,
      spells: { ...catalog_spell_sources() },
      players: [
        {
          character: 'alice',
          owner: 'owner',
          team: 0n,
          hp: 55n,
          ready: false,
          source: create_character_source({ name: 'Alice', classe: 'senshi', level: 1n }),
        },
        {
          character: 'enemy',
          owner: 'other',
          team: 1n,
          hp: 55n,
          ready: false,
          source: create_character_source({ name: 'Enemy', classe: 'senshi', level: 1n }),
        },
      ],
      mobs: [],
    },
  })
  picking.cell = Number(chain.state().contract.board.start_cells_a[1]!)
  document.body.dataset.placement_calls = '0'
  // The chain hand counts each placement it is asked to sign and never answers.
  const wallet = {
    address: 'owner',
    fight: {
      place: () =>
        new Promise(() => {
          document.body.dataset.placement_calls = String(Number(document.body.dataset.placement_calls) + 1)
        }),
    },
  } as unknown as AuthSession
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session: wallet })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [row('alice', 'Alice')] } })
  dispatch_app({ type: 'character/select', character_id: 'alice' })
  push(chain.state())
  createRoot(document.getElementById('root')!).render(
    <main className="fixed inset-0 bg-[#24202e] font-mono text-white">
      <canvas className="absolute inset-0 size-full" />
      <FightLayer copy={copy} scene={scene} resource_loader={resource_loader} />
      <div className="absolute top-3 left-3 z-[200] flex gap-3">
        <RosterCount />
      </div>
    </main>
  )
}
void boot().catch(console.error)
