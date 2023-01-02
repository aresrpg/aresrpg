import minecraftData from 'minecraft-data'
import UUID from 'uuid-1345'

import { in_chunk } from '../chunk.js'
import { block_center_position } from '../position.js'
import { VERSION } from '../settings.js'
import { to_metadata } from '../entity_metadata.js'
import { create_armor_stand } from '../armor_stand.js'
import { PlayerEvent } from '../events.js'

import { ENTITIES_PER_PLATFORM_BLOCK } from './platform.js'

const mcData = minecraftData(VERSION)

export function create_shulker_box(client, entity_id, { x, y, z }) {
  const mob = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mcData.entitiesByName.shulker.id,
    x,
    y,
    z,
    yaw: 0,
    pitch: 0,
    headPitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  }

  const metadata = {
    entityId: entity_id,
    metadata: to_metadata('shulker', {
      entity_flags: { is_invisible: true },
      has_no_gravity: true,
    }),
  }

  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
}

export function create_falling_block(client, entity_id, { x, y, z }) {
  const mob = {
    entityId: entity_id,
    objectUUID: UUID.v4(),
    type: mcData.entitiesByName.falling_block.id,
    x,
    y,
    z,
    yaw: 0,
    pitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    objectData: mcData.blocksByName.stone.id,
  }
  client.write('spawn_entity', mob)
}

function on_chunk_loaded({ world: { platforms }, client }) {
  return ({ x, z }) => {
    Object.keys(platforms).forEach(platform_id => {
      const platform = platforms[platform_id]
      const platform_state = platform.get_state()
      const { position: platform_pos } = platform_state
      if (in_chunk(platform_pos, { x, z })) {
        const {
          start_id,
          size: { width, height },
        } = platform
        Array.from({ length: width * height }).forEach((_, i) => {
          const pos = block_center_position({
            x: platform_pos.x + Math.floor(i % width),
            y: platform_pos.y,
            z: platform_pos.z + Math.floor(i / width),
          })

          create_shulker_box(
            client,
            start_id + i * ENTITIES_PER_PLATFORM_BLOCK,
            pos
          )
          create_falling_block(
            client,
            start_id + i * ENTITIES_PER_PLATFORM_BLOCK + 1,
            pos
          )
          create_armor_stand(
            client,
            start_id + i * ENTITIES_PER_PLATFORM_BLOCK + 2,
            pos
          )
          client.write('set_passengers', {
            entityId: start_id + i * ENTITIES_PER_PLATFORM_BLOCK + 2,
            passengers: [
              start_id + i * ENTITIES_PER_PLATFORM_BLOCK + 1,
              start_id + i * ENTITIES_PER_PLATFORM_BLOCK,
            ],
          })
        })
      }
    })
  }
}

function on_chunk_unloaded({ world: { platforms }, client }) {
  return ({ x, z }) => {
    Object.keys(platforms).forEach(platform_id => {
      const platform = platforms[platform_id]
      const platform_state = platform.get_state()
      const { position: platform_pos } = platform_state
      if (in_chunk(platform_pos, { x, z })) {
        const {
          start_id,
          size: { width, height },
        } = platform
        client.write('entity_destroy', {
          entityIds: Array.from({ length: width * height }).map(
            (_, i) => start_id + i
          ),
        })
      }
    })
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe(context) {
    const { events } = context
    events.on(PlayerEvent.CHUNK_LOADED, on_chunk_loaded(context))
    events.on(PlayerEvent.CHUNK_UNLOADED, on_chunk_unloaded(context))
  },
}
