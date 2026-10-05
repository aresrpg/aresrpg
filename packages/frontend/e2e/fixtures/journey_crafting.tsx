// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { JourneyTracker } from '../../src/journey/JourneyPanel.tsx'
import { JourneyHost } from '../../src/journey/JourneyHost.tsx'
import { GamePageWindow } from '../../src/components/GamePageWindow.tsx'
import { Toasts } from '../../src/components/Toasts.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { dispatch_app, read_app_state, useAppStore } from '../../src/store.ts'
import { Minimap } from '../../src/game/hud/Minimap.tsx'
import { publish_pose, read_pose } from '../../src/game/core/pose_feed.ts'
import { create_character_controller } from '../../src/game/core/character.ts'
import { begin_walking, step_walking } from '../../src/game/core/walking.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { toast } from '../../src/toast.ts'
import '../../src/tailwind.css'
import '../../src/characters/characters.css'
import '@aresrpg/ui/styles.css'

const copy = await load_app_copy('en')
const step = new URLSearchParams(location.search).get('step') ?? 'craft'
const character = {
  id: 'hero',
  name: 'Beginner',
  classe: 'senshi',
  sex: 'male',
  level: 1,
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
  kiosk: 'kiosk',
  custody: 'kiosk',
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  at_ms: 0,
  x: 50000,
  z: 50000,
  hp: '1',
  hp_ms: 0,
  equipment: [],
} as CharacterRow
const items: ItemRow[] = ['gnawed_branch', 'salvaged_scrap'].map((item_type) => ({
  id: item_type,
  item_type,
  name: content_catalog.item(item_type)!.item.name,
  category: 'resource',
  level: 1,
  amount: step === 'materials' ? 1 : 20,
  kiosk: 'kiosk',
}))
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: {
    address: 'fixture-owner',
    character: {
      craft: async () => ({
        digest: 'failed-craft',
        attempts: 1,
        successes: 0,
        job_xp_gained: 10,
        inventory_changes: [],
      }),
    },
  } as never,
})
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items } })
dispatch_app({ type: 'character/select', character_id: character.id })
if (new URLSearchParams(location.search).has('listed'))
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/listings',
      kiosk_versions: { kiosk: '1' },
      listings: [
        {
          ...items[0]!,
          kind: 'item',
          version: '1',
          price_mist: '1000000',
          seller: 'fixture-owner',
          at_ms: 0,
        },
      ],
    },
  })
const { journey, settings } = read_app_state()
dispatch_app({
  type: 'settings/changed',
  settings: { ...settings, completed_tutorials: ['world', 'characters_jobs', 'craft_failure'] },
})
dispatch_app({
  type: 'journey/loaded',
  identity: journey.identity!,
  generation: journey.generation,
  completed: {
    map: ['welcome'],
    hunt: ['welcome', 'map_travel'],
    materials: ['welcome', 'map_travel', 'first_hunt'],
    craft: ['welcome', 'map_travel', 'first_hunt', 'hoe_materials'],
  }[step] ?? ['welcome'],
})

publish_pose({ character_id: character.id, x: 0, y: 0.001, z: 0, yaw: 0, riding: false, time_of_day: 0.5 })

/** Drive the production walking/controller pair on flat terrain, without a renderer or signer. */
const MapLesson = () => {
  const run = useAppStore((state) => state.run_to.run)
  const completed = useAppStore((state) => state.journey.completed)
  useEffect(() => {
    if (run?.source !== 'map') return
    const pose = read_pose()!
    const world = {
      solid_at: (_x: number, y: number) => y < 0,
      liquid_at: () => false,
      ready: () => true,
      ground_height: () => 0,
    }
    const actor = create_character_controller({ ...world, position: [pose.x, pose.y, pose.z] })
    const target = { x: chain_to_client_coordinate(run.x), z: chain_to_client_coordinate(run.z) }
    let walking = begin_walking(actor.get_transform().position, target)
    for (let frame = 0; frame < 3000; frame++) {
      const step = step_walking(world, walking, actor.get_transform().position, target, 1 / 60)
      walking = step.state
      if (step.status === 'arrived') {
        const [x, y, z] = actor.get_transform().position
        publish_pose({ ...pose, x, y, z })
        dispatch_app({ type: 'run_to/stopped', reason: step.status })
        break
      }
      actor.set_input({ yaw: step.yaw, forward: step.forward, phase_target: step.phase_target })
      actor.tick(1 / 60)
    }
    actor.dispose()
  }, [run])
  return (
    <>
      <Minimap copy={copy} />
      <output data-journey-completed="">{completed.join(',')}</output>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <LocaleScope locale="en">
    <main className="min-h-screen bg-[#15101f] p-8 text-white">
      <JourneyTracker copy={copy} />
      <JourneyHost copy={copy} />
      <GamePageWindow copy={copy} />
      <Toasts />
      {step === 'map' && <MapLesson />}
      <button
        onClick={() =>
          toast.persistent('Action notification', 'info', {
            label: 'Acknowledge notification',
            onClick: () => toast.add('Acknowledged', 'info'),
          })
        }
      >
        Show action notification
      </button>
    </main>
  </LocaleScope>
)
