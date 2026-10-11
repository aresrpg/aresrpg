// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { character_checkpoint, parse_server_packet } from '@aresrpg/protocol'
import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'
import type { EntityRender } from '@aresrpg/engine'

import { LIFECYCLE_WORLD } from '../../../engine/test/browser_lifecycle.ts'
import { create_world } from '../../src/game/core/world.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'
import { load_pet_companion } from '../../src/content/pet_models.ts'
import { create_presence_renderer } from '../../src/game/presence_entities.ts'
import { create_position_publisher } from '../../src/game/core/position_publication.ts'
import { read_pose, subscribe_pose } from '../../src/game/core/pose_feed.ts'
import { load_game_settings } from '../../src/game/core/settings.ts'
import { dispatch_app, initialize_app_store, read_app_state } from '../../src/store.ts'

export const create_glide_world_probe = async (canvas: HTMLCanvasElement) => {
  const params = new URLSearchParams(location.search)
  const id = params.get('id') ?? '0xabc'
  initialize_app_store(load_game_settings('low'))
  const world = create_world({
    canvas,
    world: LIFECYCLE_WORLD,
    quality: 'low',
    render_distance: 1,
    initial_focus: [0, 0],
  })
  world.set_audio_volume(0)
  world.set_time_of_day(0.3)
  const appearance = await load_character_appearance({
    id,
    classe: 'senshi',
    male: false,
    colors: ['#f3eadb', '#7755bb', '#ddbb55'],
    loadout: {},
  })
  world.set_character({ id, appearance })
  world.set_pet(await load_pet_companion(`${id}:own_pet`, 'beru'))
  world.set_riding(true)
  world.set_interactive(true)
  world.set_active(true)
  let remote_entities: readonly EntityRender[] = []
  const presence = create_presence_renderer({
    submit: (entities) => {
      remote_entities = entities
      world.set_entities(entities)
    },
    pet_ground_height: world.pet_ground_height,
    label: () => {},
  })
  const socket = new WebSocket(`${params.get('relay')}?id=${id}`)
  let checkpoint: string | null = null
  const publisher = create_position_publisher({
    send: (character_id, position) => {
      if (socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify({ type: 'packet/position', character_id, ...position }))
      return true
    },
  })
  const stop_pose = subscribe_pose(() => {
    const pose = read_pose()
    if (!pose || !checkpoint) return
    publisher.publish(
      id,
      {
        checkpoint,
        x: client_to_chain_coordinate(pose.x),
        y: pose.y,
        z: client_to_chain_coordinate(pose.z),
        riding: pose.riding,
        gliding: pose.gliding,
      },
      50
    )
  })
  socket.addEventListener('message', ({ data }) => {
    const packet = parse_server_packet(String(data))
    dispatch_app({ type: 'server/packet', packet })
    if (packet.type === 'packet/characters' && !checkpoint) {
      const own = packet.characters.find((row) => row.id === id)
      if (!own) throw new Error('Glide fixture has no owned character')
      checkpoint = character_checkpoint(own)
      const x = chain_to_client_coordinate(own.x!)
      const z = chain_to_client_coordinate(own.z!)
      world.point_at({ x, y: world.ground_height(x, z) + 20, z })
      socket.send(JSON.stringify({ type: 'packet/track_character', character_id: id, tracked: true }))
    }
    presence.update(read_app_state().world.all_players, id)
  })
  let dispose_touch = () => {}
  if (params.has('touch')) {
    const [{ createElement }, { createRoot }, { TouchControls }, { load_app_copy }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../../../mobile/src/TouchControls.tsx'),
      import('../../src/i18n/copy.ts'),
    ])
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    root.render(
      createElement(TouchControls, {
        copy: await load_app_copy('en'),
        device: { set_movement: world.set_movement, set_jump: world.set_jump },
      })
    )
    dispose_touch = () => root.unmount()
  }
  window.addEventListener(
    'pagehide',
    () => {
      dispose_touch()
      stop_pose()
      presence.dispose()
      socket.close()
      world.dispose()
    },
    { once: true }
  )
  return {
    lift: () => {
      const pose = read_pose()
      if (pose) world.point_at({ x: pose.x, y: world.ground_height(pose.x, pose.z) + 20, z: pose.z })
    },
    jump: world.set_jump,
    move: world.set_movement,
    ride: world.set_riding,
    snapshot: () => ({
      status: world.state(),
      height: world.entity_height(id),
      ready: checkpoint !== null && world.state().render.settled && world.entity_height(id) !== null,
      pose: read_pose(),
      remote: remote_entities
        .filter((entity) => entity.kind === 'mob')
        .map((entity) => ({
          id: entity.id,
          gliding: entity.wings?.deployed,
          loaded: world.entity_height(entity.id) !== null,
        })),
    }),
  }
}
