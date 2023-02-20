import { on } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'

import { chunk_position, chunk_index, same_chunk } from '../chunk.js'
import { abortable } from '../iterator.js'
import { PlayerEvent, WorldRequest } from '../events.js'

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

const SYNCED_WORLD_REQUESTS = [
  WorldRequest.ADD_PLAYER_TO_WORLD,
  WorldRequest.PLAYER_HEALTH_UPDATE,
]

const SYNCED_PACKETS = ['use_entity']

const Synchroniser = {
  world_request(
    header,
    { players, storage: last_storage },
    { world, client, inside_view },
    data
  ) {
    function handle_movement({ uuid, position, last_position }) {
      const playerIdx = players.indexOf(uuid)
      // player is unknown
      if (playerIdx === -1) {
        const { array, index } = insert(players, uuid)
        const entity_id = world.next_entity_id + index

        client.write('named_entity_spawn', {
          entityId: entity_id,
          playerUUID: uuid,
          ...position,
          yaw: to_angle(position.yaw),
          pitch: to_angle(position.pitch),
        })

        const storage = {
          ...last_storage,
          [uuid]: { entity_id },
        }
        return { players: array, storage }
      }

      // Exit view distance
      if (!inside_view(position) && inside_view(last_position)) {
        client.write('entity_destroy', {
          entityIds: [world.next_entity_id + playerIdx],
        })

        const { [uuid]: destroyed, ...storage } = last_storage

        return {
          players: [
            ...players.slice(0, playerIdx),
            null,
            ...players.slice(playerIdx + 1),
          ],
          storage,
        }
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

      const { [uuid]: stored_player } = last_storage

      return {
        players,
        storage: {
          ...last_storage,
          [uuid]: {
            ...stored_player,
            position,
          },
        },
      }
    }

    switch (header) {
      case WorldRequest.ADD_PLAYER_TO_WORLD:
        if (data.UUID !== client.uuid && inside_view(data.position))
          return handle_movement({
            uuid: data.UUID,
            position: data.position,
            last_position: data.position,
          })
        break
      case WorldRequest.PLAYER_HEALTH_UPDATE:
        if (data.uuid !== client.uuid) {
          // TODO: client.write(notify ourselve that a player updated his health)
          const { [data.uuid]: stored_player } = last_storage
          return {
            players,
            storage: {
              ...last_storage,
              [data.uuid]: {
                ...stored_player,
                health: data.health,
              },
            },
          }
        }
        break
      default:
        // this may be a computed event, we will try to match the payload to handle movements
        if (
          data.uuid &&
          data.position &&
          data.last_position &&
          data.uuid !== client.uuid
        )
          handle_movement(data)
        break
    }

    return { players, storage: last_storage }
  },
  packet(
    header,
    { players, storage: last_storage },
    { world, client, dispatch, get_state },
    data
  ) {
    switch (header) {
      case 'use_entity': {
        const { target, mouse } = data
        const uuid = players[target - world.next_entity_id]
        const { position, health } = last_storage[uuid]

        dispatch(PlayerEvent.PLAYER_INTERRACTED, {
          player: {
            uuid,
            position,
            health,
          },
          mouse,
        })
        break
      }
    }
    return { players, storage: last_storage }
  },
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ world, client, events, inside_view, signal, dispatch, get_state }) {
    const player_stream = new PassThrough({ objectMode: true })
    client.once('end', () => player_stream.end())

    const forward = (type, event_source) => header =>
      aiter(abortable(on(event_source, header, { signal }))).forEach(([data]) =>
        player_stream.write({ type, header, data })
      )

    events.once(PlayerEvent.STATE_UPDATED, () =>
      SYNCED_WORLD_REQUESTS.forEach(forward('world_request', world.events))
    )

    SYNCED_PACKETS.forEach(forward('packet', client))

    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([{ position }]) => position)
      .reduce((last_position, position) => {
        if (position !== last_position) {
          const chunk_x = chunk_position(position.x)
          const chunk_z = chunk_position(position.z)

          world.events.emit(
            WorldRequest.CHUNK_POSITION_UPDATE(chunk_index(chunk_x, chunk_z)),
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
              WorldRequest.CHUNK_POSITION_UPDATE(
                chunk_index(last_chunk_x, last_chunk_z)
              ),
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

    events.on(PlayerEvent.CHUNK_LOADED, ({ x, z, signal }) => {
      forward(
        'world_request',
        world.events
      )(WorldRequest.CHUNK_POSITION_UPDATE(chunk_index(x, z)))
    })

    aiter(player_stream).reduce(
      ({ players, storage }, { type, data, header }) =>
        Synchroniser[type](
          header,
          { players, storage },
          { world, client, inside_view, dispatch, get_state },
          data
        ),
      { players: [], storage: {} }
    )
  },
}
