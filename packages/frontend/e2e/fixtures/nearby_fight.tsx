// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import {
  create_character_source,
  create_fight,
  encode_fight_action,
  fight_path_to,
  reachable_fight_cells,
} from '@aresrpg/fight'

import { LIFECYCLE_WORLD } from '../../../engine/test/browser_lifecycle.ts'
import { create_world } from '../../src/game/core/world.ts'
import { read_pose } from '../../src/game/core/pose_feed.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'
import { FightLayer } from '../../src/game/fight/FightLayer.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, initialize_app_store, observe_app, read_app_state, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

initialize_app_store({ quality: 'low', music_enabled: false, render_distance: 3 })
const stop = observe_app(['fight'])
const copy = await load_app_copy('en')
const clearance_probe = new URLSearchParams(location.search).has('clearance')
const obstruction = {
  name: 'board-clearance-probe',
  size: [2, 8, 8] as const,
  anchor: [0, 0, 0] as const,
  blocks: Array.from(
    { length: 128 },
    (_, index) => [index % 2, Math.floor(index / 16), Math.floor(index / 2) % 8, 'probe'] as const
  ),
}
const world = create_world({
  canvas: document.querySelector('canvas')!,
  world: clearance_probe
    ? {
        ...LIFECYCLE_WORLD,
        portal: false,
        materials: { ...LIFECYCLE_WORLD.materials, probe: { color: '#ff0033', preset: 'stone', emission: 2 } },
        fixed_structures: [{ source: obstruction, origin: [3, 1, -4], rotation: 0, scale: 1 }],
      }
    : LIFECYCLE_WORLD,
  quality: 'low',
  render_distance: 3,
})
world.set_audio_volume(0)
world.set_time_of_day(0.3)
world.set_active(true)
world.set_interactive(true)
world.point_at({ x: 0, z: 20 })
const appearance = await load_character_appearance({
  id: 'viewer',
  classe: 'senshi',
  male: true,
  colors: ['#f3eadb', '#2f8fe8', '#d9af57'],
  loadout: {},
})
world.set_character({ id: 'viewer', appearance })
const source = create_character_source({ classe: 'senshi', level: 10n })
const runtime = create_fight({
  mode: 'local',
  seed: 91n,
  setup: {
    fight_id: 'nearby',
    world: 'nauvis',
    x: 50_000n,
    z: 50_000n,
    board_seed: 1n,
    spells: {},
    mobs: [],
    players: [
      { character: 'stranger', owner: 'other', team: 0n, ready: true, hp: 100n, source },
      { character: 'enemy', owner: 'enemy', team: 1n, ready: true, hp: 100n, source },
    ],
  },
})
const initial = runtime.apply({ type: 'start', observed_ms: 60_000n }).state
const show = (): void => {
  dispatch_app({ type: 'fight/nearby', nearby: { character_id: 'viewer', fight: 'nearby' } })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/fight_state',
      fight: 'nearby',
      seats: {},
      state: { contract: initial.contract, players: initial.sources.players },
    },
  } as never)
}
const step_fighter = (): void => {
  const checkpoint = read_app_state().fight.cached.nearby!
  const fighter = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]!
  const target = reachable_fight_cells(checkpoint, fighter).find(
    (cell) => cell !== checkpoint.contract.fighters[Number(fighter)]!.cell
  )!
  const path = fight_path_to(checkpoint, fighter, target)!
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/fight_action',
      fight: 'nearby',
      from: 'other',
      action: encode_fight_action({ type: 'move_to', fighter, path }),
    },
  })
}
const View = () =>
  useAppStore((state) => state.fight.nearby) ? <FightLayer nearby_id="nearby" scene={world} copy={copy} /> : null
createRoot(document.getElementById('root')!).render(<View />)

const probe = {
  show,
  hide: () => dispatch_app({ type: 'fight/nearby', nearby: null }),
  step_fighter,
  walk: (forward: number) => world.set_movement({ forward, strafe: 0 }),
  snapshot: () => ({
    engine: world.state().engine,
    terrain_ready: world.state().render.settled && world.state().chunks.queued + world.state().chunks.in_flight === 0,
    viewer: world.entity_height('viewer'),
    fighter: world.entity_height('fight_character_0'),
    cell: String(
      read_app_state().fight.cached.nearby?.contract.fighters[Number(initial.contract.queue[0])]!.cell ?? ''
    ),
    queued: read_app_state().fight.environments.nearby?.presentations.length ?? 0,
    pose: read_pose(),
    camera: world.camera_frame(),
  }),
}
declare global {
  interface Window {
    nearby_probe: typeof probe
  }
}
window.nearby_probe = probe
window.addEventListener(
  'pagehide',
  () => {
    stop()
    world.dispose()
  },
  { once: true }
)
