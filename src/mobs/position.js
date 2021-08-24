import { PassThrough } from 'stream'
import { on } from 'events'

import minecraft_data from 'minecraft-data'
import UUID from 'uuid-1345'
import { aiter } from 'iterator-helper'
import Vec3 from 'vec3'

import { chunk_position, same_chunk } from '../chunk.js'
import { version } from '../settings.js'
import { write_path } from '../plugin_channels.js'
import { to_minecraft_path } from '../pathfinding.js'
import { direction_to_yaw_pitch } from '../math.js'
import { position_equal } from '../position.js'

import { Types } from './types.js'
import { path_to_positions, path_position } from './path.js'
import { wakeup_to_end } from './wakeup.js'

const { entitiesByName } = minecraft_data(version)

const color_by_type = {
  mob: 'white',
  archiMob: 'gold',
  boss: 'red',
  npc: 'green',
  garde: 'blue',
}

const chunk_index = (x, z) => `${x}:${z}`

function write_mob(client, { mob: { entity_id, mob, level }, position }) {
  const { type, mob: entity_type, displayName } = Types[mob]

  client.write('spawn_entity_living', {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: entitiesByName[entity_type].id,
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: 0,
    pitch: 0,
    headPitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  })

  client.write('entity_metadata', {
    entityId: entity_id,
    metadata: [
      {
        key: 2,
        type: 5,
        value: JSON.stringify({
          text: displayName + `(${entity_id})`,
          color: color_by_type[type],
          extra: level && [{ text: ` [Lvl ${level}]`, color: 'dark_red' }],
        }),
      },
      {
        key: 3,
        type: 7,
        value: true,
      },
    ],
  })
}

function get_chunk(chunks, { x, z }) {
  return chunks.get(chunk_index(x, z)) || { clients: [], mobs: [] }
}

function client_chunk_loaded(chunks, { client, x, z }) {
  const chunk = get_chunk(chunks, { x, z })

  const time = Date.now()
  for (const { mob, position } of chunk.mobs) {
    if (mob.get_state().wakeup_at <= time) mob.dispatch('wakeup', null, time)
    write_mob(client, { mob, position })
  }

  return new Map([
    ...chunks.entries(),
    [chunk_index(x, z), { ...chunk, clients: [...chunk.clients, client] }],
  ])
}

function client_chunk_unloaded(chunks, { client, x, z }) {
  const chunk = get_chunk(chunks, { x, z })

  client.write('entity_destroy', {
    entityIds: chunk.mobs.map(({ mob: { entity_id } }) => entity_id),
  })

  return new Map([
    ...chunks.entries(),
    [
      chunk_index(x, z),
      { ...chunk, clients: chunk.clients.filter(c => c !== client) },
    ],
  ])
}

function mob_position(chunks, { mob, position, last_position, target }) {
  const x = chunk_position(position.x)
  const z = chunk_position(position.z)

  const chunk = get_chunk(chunks, { x, z })

  if (last_position != null && !position_equal(position, last_position)) {
    const delta_x = (position.x * 32 - last_position.x * 32) * 128
    const delta_y = (position.y * 32 - last_position.y * 32) * 128
    const delta_z = (position.z * 32 - last_position.z * 32) * 128

    for (const client of chunk.clients) {
      const { yaw: headYaw, pitch } = direction_to_yaw_pitch(
        Vec3(target).subtract(Vec3(position))
      )
      const { yaw } = direction_to_yaw_pitch(
        Vec3(position).subtract(Vec3(last_position))
      )

      client.write('entity_move_look', {
        entityId: mob.entity_id,
        dX: delta_x,
        dY: delta_y,
        dZ: delta_z,
        pitch,
        yaw,
        onGround: true,
      })

      if (!position_equal(target, position)) {
        client.write('entity_head_rotation', {
          entityId: mob.entity_id,
          headYaw,
        })
      }
    }
  }

  if (last_position != null && !same_chunk(last_position, position)) {
    const last_x = chunk_position(last_position.x)
    const last_z = chunk_position(last_position.z)
    const last_chunk = chunks.get(chunk_index(last_x, last_z))

    return new Map([
      ...chunks.entries(),
      [
        chunk_index(last_x, last_z),
        {
          ...last_chunk,
          mobs: last_chunk.mobs.filter(
            ({ mob: { entity_id } }) => entity_id !== mob.entity_id
          ),
        },
      ],
      [
        chunk_index(x, z),
        {
          ...chunk,
          mobs: [...chunk.mobs, { mob, position }],
        },
      ],
    ])
  } else {
    return new Map([
      ...chunks.entries(),
      [
        chunk_index(x, z),
        {
          ...chunk,
          mobs: [
            ...chunk.mobs.filter(
              ({ mob: { entity_id } }) => entity_id !== mob.entity_id
            ),
            { mob, position },
          ],
        },
      ],
    ])
  }
}

function mob_path(chunks, { mob, path, open, closed }) {
  const path_chunks = new Set(
    path.map(point =>
      get_chunk(chunks, {
        x: chunk_position(point.x),
        z: chunk_position(point.z),
      })
    )
  )

  for (const { clients } of path_chunks) {
    for (const client of clients) {
      write_path(client, {
        id: mob.entity_id,
        radius: 0.4,
        path: to_minecraft_path({ path, open, closed }),
      })
    }
  }

  return chunks
}

function mob_wakeup(chunks, { mob, time }) {
  const { path, start_time, speed } = mob.get_state()
  const position = path_position({ path, time, start_time, speed })
  const x = chunk_position(position.x)
  const z = chunk_position(position.z)

  const chunk = get_chunk(chunks, { x, z })

  if (chunk.clients.length > 0) mob.dispatch('wakeup', null, time)

  return chunks
}

export default function update_clients(world) {
  const actions = new PassThrough({ objectMode: true })

  for (const mob of world.mobs.all) {
    {
      const state = aiter(on(mob.events, 'state')).map(([state]) => state)

      const positions = path_to_positions(state)

      aiter(positions).reduce((last_position, { position, target }) => {
        if (last_position !== position) {
          actions.write({
            type: 'mob_position',
            payload: {
              mob,
              last_position,
              position,
              target,
            },
          })
        }
        return position
      }, null)
    }

    {
      const state = aiter(on(mob.events, 'state')).map(([state]) => state)

      const wakeups = wakeup_to_end(state)

      aiter(wakeups).reduce((last_time, time) => {
        if (last_time !== time) {
          actions.write({
            type: 'mob_wakeup',
            payload: {
              mob,
              time,
            },
          })
        }
        return time
      }, null)
    }

    aiter(on(mob.events, 'state')).reduce(
      (last_path, [{ path, open, closed }]) => {
        if (last_path !== path) {
          actions.write({
            type: 'mob_path',
            payload: {
              mob,
              path,
              open,
              closed,
            },
          })
        }
        return path
      },
      null
    )
  }

  /** @type {import('../index.js').Observer} */
  function update_mobs({ events, client }) {
    events.on('chunk_loaded', ({ x, z }) => {
      actions.write({ type: 'client_chunk_loaded', payload: { client, x, z } })
    })

    events.on('chunk_unloaded', ({ x, z }) =>
      actions.write({
        type: 'client_chunk_unloaded',
        payload: { client, x, z },
      })
    )
  }

  aiter(actions).reduce((chunks, { type, payload }) => {
    switch (type) {
      case 'client_chunk_loaded':
        return client_chunk_loaded(chunks, payload)
      case 'client_chunk_unloaded':
        return client_chunk_unloaded(chunks, payload)
      case 'mob_position':
        return mob_position(chunks, payload)
      case 'mob_path':
        return mob_path(chunks, payload)
      case 'mob_wakeup':
        return mob_wakeup(chunks, payload)
      default:
        throw new Error(`unknown type: ${type}`)
    }
  }, new Map())

  return {
    observe: update_mobs,
  }
}
