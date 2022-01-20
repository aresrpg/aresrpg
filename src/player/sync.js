import { on } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'

import { chunk_position, chunk_index, same_chunk } from '../chunk.js'
import { abortable } from '../iterator.js'
import { Context, World } from '../events.js'

function insert(array, value) {
  const nullIdx = array.indexOf(null)

  if (nullIdx === -1) {
    return { array: [...array, value], index: array.length }
  } else {
    return {
      array: [...array.slice(0, nullIdx), value, ...array.slice(nullIdx + 1)],
      index: nullIdx,
    }
  }
}

function to_angle(raw) {
  const value = raw % 360
  const bounded = value + (value > 180 ? -360 : 0) + (value < -180 ? 360 : 0)

  return Math.floor((bounded / 360) * 255)
}

export default {
  observe({ world, client, events, inside_view, signal }) {
    const player_stream = new PassThrough({ objectMode: true })
    client.once('end', () => player_stream.end())

    const on_player = player => {
      if (player.UUID !== client.uuid && inside_view(player.position)) {
        player_stream.write({
          uuid: player.UUID,
          last_position: player.position,
          position: player.position,
        })
      }
    }

    client.once('end', () => world.events.off(World.PLAYER, on_player))
    events.once(Context.STATE, () => world.events.on(World.PLAYER, on_player))

    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ position }]) => position)
      .reduce((last_position, position) => {
        if (position !== last_position) {
          const chunk_x = chunk_position(position.x)
          const chunk_z = chunk_position(position.z)

          world.events.emit(
            World.CHUNK_POSITION(chunk_index(chunk_x, chunk_z)),
            {
              uuid: client.uuid,
              last_position,
              position,
            }
          )

          if (!same_chunk(position, last_position)) {
            const last_chunk_x = chunk_position(last_position.x)
            const last_chunk_z = chunk_position(last_position.z)

            world.events.emit(
              World.CHUNK_POSITION(chunk_index(last_chunk_x, last_chunk_z)),
              {
                uuid: client.uuid,
                last_position,
                position,
              }
            )
          }
        }
        return position
      })

    events.on(Context.CHUNK_LOADED, ({ x, z, signal }) => {
      aiter(
        abortable(
          on(world.events, World.CHUNK_POSITION(chunk_index(x, z)), { signal })
        )
      )
        .map(([event]) => event)
        .filter(({ uuid }) => uuid !== client.uuid)
        .forEach(data => player_stream.write(data))
    })

    aiter(player_stream).reduce(
      (players, { uuid, position, last_position }) => {
        const playerIdx = players.indexOf(uuid)

        if (playerIdx === -1) {
          const { array, index } = insert(players, uuid)

          client.write('named_entity_spawn', {
            entityId: world.next_entity_id + index,
            playerUUID: uuid,
            ...position,
            yaw: to_angle(position.yaw),
            pitch: to_angle(position.pitch),
          })

          return array
        }

        // Exit view distance
        if (!inside_view(position) && inside_view(last_position)) {
          client.write('entity_destroy', {
            entityIds: [world.next_entity_id + playerIdx],
          })
          return [
            ...players.slice(0, playerIdx),
            null,
            ...players.slice(playerIdx + 1),
          ]
        }

        const delta_x = (position.x * 32 - last_position.x * 32) * 128
        const delta_y = (position.y * 32 - last_position.y * 32) * 128
        const delta_z = (position.z * 32 - last_position.z * 32) * 128

        const yaw = to_angle(position.yaw)

        client.write('entity_move_look', {
          entityId: world.next_entity_id + playerIdx,
          dX: delta_x,
          dY: delta_y,
          dZ: delta_z,
          pitch: to_angle(position.pitch),
          yaw,
          onGround: position.onGround,
        })

        client.write('entity_head_rotation', {
          entityId: world.next_entity_id + playerIdx,
          headYaw: yaw,
        })

        return players
      },
      []
    )
  },
}
