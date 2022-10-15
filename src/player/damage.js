import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'
import Vec3 from 'vec3'
import mdata from 'minecraft-data'

import { Action, Context } from '../events.js'
import { create_armor_stand } from '../armor_stand.js'
import logger from '../logger.js'
import { GameMode } from '../gamemode.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { VERSION } from '../settings.js'
const DAMAGE_INDICATORS_AMOUNT = 10
const DAMAGE_INDICATOR_TTL = 1200

const mcData = mdata(VERSION)
const log = logger(import.meta)

/** @param {import('../context.js').InitialWorld} world */
export function register({ next_entity_id, ...world }) {
  return {
    ...world,
    damage_indicator_start_id: next_entity_id,
    next_entity_id: next_entity_id + DAMAGE_INDICATORS_AMOUNT,
  }
}
/**
 * Spawns a particle for a player
 */
export function world_particle(
  client,
  particleName,
  position,
  { size = Vec3([1, 1, 1]), count = 1 } = {},
  blockStateId = null
) {
  const particle = mcData.particlesByName[particleName]

  const options = {
    particleId: particle.id,
    longDistance: true,
    ...position,
    offsetX: size.x,
    offsetY: size.y,
    offsetZ: size.z,
    particleData: 1.0, // maxspeed
    particles: count,
    ...(blockStateId != null && {
      data: {
        blockState: blockStateId,
      },
    }),
  }
  client.write('world_particles', options)
  log.info({ pseudo: client.username, particle }, 'Spawning a particle ')
}
export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.DAMAGE && state.game_mode !== GameMode.CREATIVE) {
      const { damage } = payload
      const health = Math.max(0, state.health - damage)

      log.info({ damage, health }, 'took damage')

      return {
        ...state,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    aiter(
      abortable(
        // @ts-ignore
        combineAsyncIterators(
          on(events, Context.MOB_DAMAGE, { signal }),
          on(events, Context.MOB_DEATH, { signal }),
          setInterval(DAMAGE_INDICATOR_TTL / 2, [{ timer: true }], { signal })
        )
      )
    )
      .map(([{ mob, damage, timer }]) => ({ mob, damage, timer }))
      .reduce(
        ({ cursor: last_cursor, ids }, { mob, damage, timer }) => {
          if (timer) {
            // entering here means the iteration is trigered by the interval
            const now = Date.now()
            ids
              .filter(({ age }) => age + DAMAGE_INDICATOR_TTL < now)
              .forEach(({ entity_id }) =>
                client.write('entity_destroy', {
                  entityIds: [entity_id],
                })
              )
            return { cursor: last_cursor, ids }
          }

          const { damage_indicator_start_id } = world
          const cursor = (last_cursor + 1) % DAMAGE_INDICATORS_AMOUNT
          const entity_id = damage_indicator_start_id + cursor
          const { x, y, z } = mob.position()
          const { height } = mob.constants
          const position = {
            x: x + (Math.random() * 2 - 1) * 0.25,
            y: y + height - 0.25 + (Math.random() * 2 - 1) * 0.15,
            z: z + (Math.random() * 2 - 1) * 0.25,
          }
          if (damage !== undefined) {
            create_armor_stand(client, entity_id, position, {
              text: `-${damage}`,
              color: '#E74C3C', // https://materialui.co/flatuicolors Alizarin
            })
            world_particle(
              client,
              'block',
              Vec3([x, y + height * 0.7, z]),
              { count: 10, size: Vec3([0, 0, 0]) },
              mcData.blocksByName.redstone_block.defaultState
            )
          } else {
            // Death
            const { xp } = Entities[mob.type]
            create_armor_stand(client, entity_id, position, {
              text: `+${xp} xp`,
              color: '#A6CD57',
            })
          }
          return {
            cursor,
            ids: [
              ...ids.slice(0, cursor),
              { entity_id, age: Date.now() },
              ...ids.slice(cursor + 1),
            ],
          }
        },
        {
          cursor: -1,
          ids: Array.from({ length: DAMAGE_INDICATORS_AMOUNT }).fill({
            age: Infinity,
          }),
        }
      )
  },
}
