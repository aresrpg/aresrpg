import minecraftData from 'minecraft-data'
import UUID from 'uuid-1345'

import { chunk_position } from '../chunk.js'
import { version } from '../settings.js'
import { item_to_slot } from '../items.js'

import { mobs } from './mobs.js'
const mcData = minecraftData(version)

const color_by_type = {
  mob: 'white',
  archiMob: 'gold',
  boss: 'red',
  npc: 'green',
  garde: 'blue',
}

const chunk_index = (x, z) => `${x}:${z}`

export function register_mobs(world) {
  // generate an object containing mobs by chunk
  const mobs_in_chunk = world.mobs.reduce(
    (map, { position, mob: mob_name, level }, i) => {
      const chunk_x = chunk_position(position.x)
      const chunk_z = chunk_position(position.z)
      const index = chunk_index(chunk_x, chunk_z)
      const entry = map.get(index) || []

      if (!(mob_name in mobs)) throw new Error(`Invalid mob ${mob_name}`)
      const mob = mobs[mob_name]

      if (!(mob.mob in mcData.entitiesByName)) {
        throw new Error(`Invalid 'mob' in ${JSON.stringify(mob)}`)
      }
      if (!(mob.type in color_by_type)) {
        throw new Error(`Invalid 'type' in ${JSON.stringify(mob)}`)
      }
      return new Map([
        ...map.entries(),
        [
          index,
          [...entry, { ...mob, position, level, id: world.next_entity_id + i }],
        ],
      ])
    },
    new Map()
  )

  return {
    ...world,
    next_entity_id: world.next_entity_id + world.mobs.length,
    mobs: {
      mobs_in_chunk,
    },
  }
}

export function spawn_mob({ client, events, world }) {
  const { mobs_in_chunk } = world.mobs
  events.on('chunk_loaded', ({ x, z }) => {
    if (mobs_in_chunk.has(chunk_index(x, z))) {
      for (const {
        id,
        mob: minecraft_mob,
        displayName,
        type,
        level,
        position,
        equipment,
      } of mobs_in_chunk.get(chunk_index(x, z))) {
        const mob = {
          entityId: id,
          entityUUID: UUID.v4(),
          type: mcData.entitiesByName[minecraft_mob].id,
          x: position.x,
          y: position.y,
          z: position.z,
          yaw: 0,
          pitch: 0,
          headPitch: 0,
          velocityX: 400,
          velocityY: 400,
          velocityZ: 400,
        }

        const metadata = {
          entityId: id,
          metadata: [
            {
              key: 2,
              value: JSON.stringify({
                text: displayName,
                color: color_by_type[type],
                extra: level && [
                  { text: ` [Lvl ${level}]`, color: 'dark_red' },
                ],
              }),
              type: 5,
            },
            {
              key: 3,
              type: 7,
              value: true,
            },
          ],
        }

        client.write('spawn_entity_living', mob)
        client.write('entity_metadata', metadata)

        if (equipment) {
          const equipment_map = {
            main_hand: 0,
            off_hand: 1,
            boots: 2,
            leggings: 3,
            chestplate: 4,
            helmet: 5,
          }

          const entity_equipment = {
            entityId: id,
            equipments: Object.keys(equipment).map((slot) => ({
              slot: equipment_map[slot],
              item: item_to_slot(
                world.items[equipment[slot].type],
                equipment[slot].count
              ),
            })),
          }
          client.write('entity_equipment', entity_equipment)
        }
      }
    }
  })

  events.on('chunk_unloaded', ({ x, z }) => {
    if (mobs_in_chunk.has(chunk_index(x, z))) {
      client.write('entity_destroy', {
        entityIds: mobs_in_chunk.get(chunk_index(x, z)).map(({ id }) => id),
      })
    }
  })
}
