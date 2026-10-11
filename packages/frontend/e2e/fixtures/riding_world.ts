// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_world } from '../../src/game/core/world.ts'
import { world_terrain } from '../../src/content/worlds.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { load_pet_model_url } from '../../src/content/pet_models.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'
import { pet_locomotion_of } from '../../src/game/core/pet_locomotion.ts'
import { read_pose } from '../../src/game/core/pose_feed.ts'

export const create_riding_world_probe = async (canvas: HTMLCanvasElement) => {
  const world = create_world({
    canvas,
    world: world_terrain('nauvis'),
    quality: 'low',
    render_distance: 32,
    initial_focus: [-8, 17],
  })
  world.set_audio_volume(0)
  world.set_time_of_day(0.3)
  const appearance = await load_character_appearance({
    id: 'ride_world',
    classe: 'senshi',
    male: false,
    colors: ['#f3eadb', '#7755bb', '#ddbb55'],
    loadout: {},
  })
  const set_pet = async (item_type: string) => {
    const model_url = await load_pet_model_url(item_type)
    const item = content_catalog.item(item_type)?.item
    if (!model_url || !item) throw new Error(`Missing pet ${item_type}`)
    world.set_pet({ id: 'ride_pet', model_url, locomotion: pet_locomotion_of(item) })
  }
  world.set_character({ id: 'ride_world', appearance })
  await set_pet('suicune')
  world.point_at({ x: -8, z: 17 })
  world.set_riding(true)
  world.set_interactive(true)
  world.set_active(true)
  window.addEventListener('pagehide', () => world.dispose(), { once: true })
  return {
    ready: () =>
      world.state().render.settled &&
      world.entity_height('ride_world') !== null &&
      world.entity_height('ride_pet') !== null,
    snapshot: () => ({
      pose: read_pose(),
      camera: world.camera_frame(),
      riding: world.riding(),
      first_person: world.follow_camera().is_first_person(),
      pet_height: world.entity_height('ride_pet'),
    }),
    set_pet,
    ride: world.set_riding,
    move: world.set_movement,
    first_person: () => world.follow_camera().dolly(-20),
  }
}
