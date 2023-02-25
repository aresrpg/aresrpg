import { on } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'

import { chunk_index } from '../chunk.js'
import { abortable } from '../iterator.js'
import { PlayerEvent, WorldRequest } from '../events.js'
import { to_metadata } from '../entity_metadata.js'

import { SCOREBOARD_NAME } from './health.js'

const SYNCED_PACKETS = ['use_entity']

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

function send_health(client, { entity_id, health, username }) {
  client.write('entity_metadata', {
    entityId: entity_id,
    metadata: to_metadata('player', { health }),
  })
  client.write('scoreboard_score', {
    itemName: username,
    action: 0, // create / update
    scoreName: SCOREBOARD_NAME,
    value: health,
  })
}

function send_equipment(
  client,
  { entity_id, helmet, chestplate, leggings, boots, held_item }
) {
  client.write('entity_equipment', {
    entityId: entity_id,
    equipments: [
      { slot: 0, item: held_item },
      { slot: 2, item: boots },
      { slot: 3, item: leggings },
      { slot: 4, item: chestplate },
      { slot: 5, item: helmet },
    ],
  })
}

const Synchroniser = {
  world_request(
    header,
    { players: last_players, storage: last_storage },
    { world, client, inside_view },
    data
  ) {
    function insert_new_index(uuid, position) {
      const { array, index } = insert(last_players, uuid)
      const entity_id = world.next_entity_id + index

      client.write('named_entity_spawn', {
        entityId: entity_id,
        playerUUID: uuid,
        ...position,
        yaw: to_angle(position.yaw),
        pitch: to_angle(position.pitch),
      })

      return { players: array, index }
    }

    function handle_presence(
      {
        uuid,
        position,
        last_position = position,
        username,
        health,
        helmet,
        chestplate,
        leggings,
        boots,
        held_item,
      },
      { position_only } = {}
    ) {
      const player_index = last_players.indexOf(uuid)
      const entity_id = world.next_entity_id + player_index
      const stored_player = {
        position,
        entity_id,
        username,
        health,
        helmet,
        chestplate,
        leggings,
        boots,
        held_item,
      }

      if (player_index === -1) {
        const { players, index } = insert_new_index(uuid, position)
        return {
          players,
          storage: {
            ...last_storage,
            [uuid]: {
              ...stored_player,
              entity_id: world.next_entity_id + index,
            },
          },
        }
      }

      // left view, removing
      if (!inside_view(position) && inside_view(last_position)) {
        client.write('entity_destroy', {
          entityIds: [entity_id],
        })

        const { [uuid]: unregistered, ...storage } = last_storage

        return {
          players: [
            ...last_players.slice(0, player_index),
            null,
            ...last_players.slice(player_index + 1),
          ],
          storage,
        }
      }

      const delta_x = (position.x * 32 - last_position.x * 32) * 128
      const delta_y = (position.y * 32 - last_position.y * 32) * 128
      const delta_z = (position.z * 32 - last_position.z * 32) * 128
      const yaw = to_angle(position.yaw)

      // delta must be a float or the client will crash (minecraft-protocol also)
      const bounded_delta = value => Math.max(-32768, Math.min(value, 32767))

      client.write('entity_move_look', {
        entityId: entity_id,
        dX: bounded_delta(delta_x),
        dY: bounded_delta(delta_y),
        dZ: bounded_delta(delta_z),
        pitch: to_angle(position.pitch),
        yaw,
        onGround: position.onGround,
      })

      client.write('entity_head_rotation', {
        entityId: entity_id,
        headYaw: yaw,
      })

      // the position update is so fast,
      // we handle it with a separate packet that contains only the position
      // while when it's a chunk position update, it contains infos like health, armor..
      if (position_only) {
        const { [uuid]: stored_player } = last_storage
        return {
          players: last_players,
          storage: {
            ...last_storage,
            [uuid]: {
              ...stored_player,
              position,
              entity_id,
            },
          },
        }
      }

      send_health(client, stored_player)
      send_equipment(client, stored_player)

      return {
        players: last_players,
        storage: {
          ...last_storage,
          [uuid]: stored_player,
        },
      }
    }

    const { uuid } = data
    const { [uuid]: stored_player } = last_storage

    if (uuid !== client.uuid) {
      if (header.startsWith('WORLD:POSITION'))
        return handle_presence(data, { position_only: true })
      if (header.startsWith('WORLD:CHUNK_POSITION'))
        return handle_presence(data)

      switch (header) {
        case WorldRequest.NOTIFY_PRESENCE_TO(client.uuid):
          if (inside_view(data.position)) return handle_presence(data)
          break
        case WorldRequest.PLAYER_HEALTH_UPDATE: {
          if (stored_player) {
            const { health, username } = data
            const { entity_id } = stored_player
            send_health(client, { health, username, entity_id })
            return {
              players: last_players,
              storage: {
                ...last_storage,
                [data.uuid]: {
                  ...stored_player,
                  health,
                },
              },
            }
          }
          break
        }
        case WorldRequest.PLAYER_DIED:
          // if we know about this player
          if (stored_player) {
            const { position } = stored_player
            // @ts-expect-error
            return handle_presence({
              uuid,
              last_position: position,
              // this is fine because we checked first if the player was stored
              // this will simply destroy the entity
              position: null,
            })
          }
          break
        case WorldRequest.PLAYER_RESPAWNED:
          if (inside_view(data.position)) return handle_presence(data)
          break
        case WorldRequest.RESYNC_DISPLAYED_INVENTORY: {
          if (stored_player) send_equipment(client, stored_player)
          break
        }
      }
    }

    return { players: last_players, storage: last_storage }
  },

  packet(
    header,
    { players, storage: last_storage },
    { world, client, dispatch, get_state, events },
    data
  ) {
    switch (header) {
      case 'use_entity': {
        const { target, mouse } = data
        // if entity_id of a player
        if (target >= world.next_entity_id) {
          const uuid = players[target - world.next_entity_id]
          // if player is visible by us (stored)
          if (uuid) {
            const { position, health, username } = last_storage[uuid]

            events.emit(PlayerEvent.PLAYER_INTERRACTED, {
              player: {
                uuid,
                position,
                health,
                username,
                entity_id: target,
              },
              mouse,
            })
          }
        }
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

    // @ts-expect-error No overload matches this call.
    client.once('end', () => player_stream.end())

    const forward =
      (type, event_source, local_signal = signal) =>
      header =>
        aiter(
          abortable(on(event_source, header, { signal: local_signal }))
        ).forEach(([data]) => player_stream.write({ type, header, data }))

    events.once(PlayerEvent.STATE_UPDATED, () => {
      const synced_requests = [
        WorldRequest.PLAYER_HEALTH_UPDATE,
        WorldRequest.NOTIFY_PRESENCE_TO(client.uuid),
        WorldRequest.PLAYER_DIED,
        WorldRequest.PLAYER_RESPAWNED,
        WorldRequest.RESYNC_DISPLAYED_INVENTORY,
      ]
      synced_requests.forEach(forward('world_request', world.events))
    })

    SYNCED_PACKETS.forEach(forward('packet', client))

    events.on(PlayerEvent.CHUNK_LOADED, ({ x, z, signal: chunk_signal }) => {
      const chunk = chunk_index(x, z)
      const synced_events = [
        WorldRequest.POSITION_UPDATE(chunk),
        WorldRequest.CHUNK_POSITION_UPDATE(chunk),
      ]

      synced_events.forEach(
        forward('world_request', world.events, chunk_signal)
      )
    })

    aiter(player_stream).reduce(
      ({ players, storage }, { type, data, header }) => {
        const result = Synchroniser[type](
          header,
          { players, storage },
          { world, client, inside_view, dispatch, get_state, events },
          data
        )
        // console.dir({ username: client.username, result }, { depth: Infinity })
        return result
      },
      { players: [], storage: {} }
    )
  },
}
