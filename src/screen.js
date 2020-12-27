import minecraftData from 'minecraft-data'
import UUID from 'uuid-1345'
import Vec3 from 'vec3'

import { version } from './settings.js'

const mcData = minecraftData(version)

export function register_screen({ screen_id, screen_size: { width, height } }) {
  return (world) => ({
    ...world,
    screens: {
      ...world.screens,
      [screen_id]: {
        screen_size: { width, height },
        screen_start_id: world.next_entity_id,
      },
    },
    next_entity_id: world.next_entity_id + width * height,
  })
}

export function spawn_item_frame(
  client,
  { entityId, position: { x, y, z, yaw, pitch } }
) {
  client.write('spawn_entity', {
    entityId,
    objectUUID: UUID.v4(),
    type: mcData.entitiesByName.item_frame.id,
    x,
    y,
    z,
    yaw,
    pitch,
    headPitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    objectData: 3,
  })

  client.write('entity_metadata', {
    entityId,
    metadata: [
      {
        key: 7,
        value: {
          present: true,
          itemId: mcData.itemsByName.filled_map.id,
          itemCount: 1,
          nbtData: {
            type: 'compound',
            name: 'tag',
            value: {
              map: {
                type: 'int',
                value: entityId,
              },
            },
          },
        },
        type: 6,
      },
    ],
  })
}

export function spawn_screen(
  { client, world },
  { screen_id, position, direction }
) {
  const up = Vec3(0, 1, 0)
  const right = Vec3(1, 0, 0)
  const dir = Vec3(direction.x, direction.y, direction.z).normalize()
  const forward = dir.cross(up)

  const pitch = Math.acos(forward.dot(up)) * (128 / Math.PI) - 128 + 64
  const yaw = Math.acos(forward.dot(right)) * (128 / Math.PI) - 128 + 64

  const { screen_size, screen_start_id } = world.screens[screen_id]

  for (let frame_y = 0; frame_y < screen_size.height; frame_y++) {
    for (let frame_x = 0; frame_x < screen_size.width; frame_x++) {
      const index = frame_x + frame_y * screen_size.width

      const frame_pos = dir.scaled(frame_x).add(position).offset(0, -frame_y, 0)
      frame_pos.pitch = pitch
      frame_pos.yaw = yaw

      spawn_item_frame(client, {
        entityId: index + screen_start_id,
        position: frame_pos,
      })
    }
  }
}

export function update_screen(
  { client, world },
  { screen_id, newDatas, oldDatas }
) {
  const { screen_size, screen_start_id } = world.screens[screen_id]

  for (let frame = 0; frame < screen_size.width * screen_size.height; frame++) {
    const buff = Buffer.alloc(128 * 128, 4)
    let different = !oldDatas
    for (let x = 0; x < 128; x++) {
      for (let y = 0; y < 128; y++) {
        const real_x = (frame % screen_size.width) * 128 + x
        const real_y = Math.floor(frame / screen_size.width) * 128 + y
        const data_index = real_x + real_y * (screen_size.width * 128)

        if (oldDatas && newDatas[data_index] !== oldDatas[data_index])
          different = true

        buff[x + y * 128] = newDatas[data_index]
      }
    }

    if (different) {
      client.write('map', {
        itemDamage: screen_start_id + frame,
        scale: 1,
        trackingPosition: false,
        locked: false,
        icons: [],
        columns: -128,
        rows: -128,
        x: 0,
        y: 0,
        data: buff,
      })
    }
  }
  return { newDatas }
}

export function destroy_screen({ client, world }, { screen_id }) {
  const { screen_size, screen_start_id } = world.screens[screen_id]

  client.write('entity_destroy', {
    entityIds: Array.from({
      length: screen_size.width * screen_size.height,
    }).map((v, index) => screen_start_id + index),
  })
}
