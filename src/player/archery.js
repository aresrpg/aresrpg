import UUID from 'uuid-1345'
import { abortable } from '../iterator.js'
import { setInterval as interval} from 'timers/promises'
import { on } from 'events'
import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'
import Items from '../../data/items.json' assert { type: 'json' }
import { Action, Context, MobAction } from '../events.js'
import { direction_to_yaw_pitch, distance2d_squared, distance3d_squared, sort_by_distance2d, to_direction } from '../math.js'
import logger from '../logger.js'
import position from './position.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { get_block } from '../chunk.js'
import { block_center_position } from '../position.js'
import { world_chat_msg } from '../chat.js'

const log = logger(import.meta)
const visible_mobs = {}

const HOTBAR_OFFSET = 36
const Hand = {
  MAINHAND: 0,
}

const ARROW_AMOUNT = 50
const ARROW_LIFE_TIME = 3000

/** @param {import('../context.js').InitialWorld} world */
export function register({ next_entity_id, ...world }) {
  return {
    ...world,
    arrow_start_id: next_entity_id,
    next_entity_id: next_entity_id + ARROW_AMOUNT,
  }
}

async function get_path_collision(world, position, velocity, steps) {
  for (let id = 1; id < steps; id++) {
    velocity.y = Math.max(-32768, velocity.y-98)
    position.x+=velocity.x/8000
    position.y+=velocity.y/8000
    position.z+=velocity.z/8000

    const block = await get_block(world, position)
    if (block.boundingBox === 'block') {
      return id
    }
    id++
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, signal, dispatch, events, world }) {
    aiter(
      abortable(
        // @ts-ignore
        combineAsyncIterators(
          on(events, Context.SHOOT, { signal }),
          interval(ARROW_LIFE_TIME / 2, [{ timer: true }], { signal })
        )
      )
    )
      .map(([{sender, position, velocity, wall_predict, timer}]) => ({sender, position, velocity, wall_predict, timer}))
      .reduce(
        ({ cursor: last_cursor, ids }, { sender, position, velocity, wall_predict, timer }) => {
          if (timer) {
            // entering here means the iteration is trigered by the interval
            const now = Date.now()
            ids
              .filter(({ age }) => age + ARROW_LIFE_TIME < now)
              .forEach(({ entity_id }) =>
                client.write('entity_destroy', {
                  entityIds: [entity_id],
                })
              )
            return { cursor: last_cursor, ids }
          }

          const { arrow_start_id } = world
          const delta = 0.05
          const cursor = (last_cursor + 1) % ARROW_AMOUNT
          const arrow = {
            entityId: arrow_start_id + cursor,
            objectUUID: UUID.v4(),
            objectData: sender.ids,
            damage: 5,
            originalVelocity: velocity,
            position
          }
          client.write('spawn_entity', {
            ...arrow,
            type: 2,
            ...position,
            ...direction_to_yaw_pitch(to_direction(position.yaw, position.pitch)),
            velocityX: velocity.x,
            velocityY: velocity.y,
            velocityZ: velocity.z,
          })
          let t = 0
          const interval = setInterval(() => {
            velocity.y = Math.max(-32768, velocity.y-98)
            if (wall_predict === t/delta) {
              client.write('rel_entity_move', {
                entityId: arrow.entityId,
                dX: velocity.x,
                dY: velocity.y,
                dZ: velocity.z,
                onGround: true
              })
              return
            }
            if (t > ARROW_LIFE_TIME/1000) {
              clearInterval(interval)
            } else {
              const cur_pos = {
                x: arrow.position.x+velocity.x/8000,
                y: arrow.position.y+velocity.y/8000,
                z: arrow.position.z+velocity.z/8000,
              }
              
              Object.values(visible_mobs).forEach((mob) => {
                if (mob.health === 0) return 
                const mob_pos = mob.position()
                const dist = distance3d_squared(cur_pos, mob_pos)
                if (dist < 1) {
                  mob.dispatch(MobAction.DEAL_DAMAGE, {
                    damage: arrow.damage,
                    damager: sender.uuid,
                  })
                  client.write('entity_destroy', {
                    entityIds: [arrow.entityId],
                  })
                  clearInterval(interval)
                }
              })
              client.write('rel_entity_move', {
                entityId: arrow.entityId,
                dX: velocity.x,
                dY: velocity.y,
                dZ: velocity.z,
                onGround: false
              })
              client.write('entity_velocity', {
                entityId: arrow.entityId,
                velocityX: velocity.x,
                velocityY: velocity.y,
                velocityZ: velocity.z,
              })
              arrow.position = cur_pos
            }
            t += delta
          }, 50)
          return {
            cursor,
            ids: [
              ...ids.slice(0, cursor),
              { entity_id: arrow.entityId, age: Date.now() },
              ...ids.slice(cursor + 1),
            ],
          }
        },
        {
          cursor: -1,
          ids: Array.from({ length: ARROW_AMOUNT }).fill({
            age: Infinity,
          }),
        }
      )

    events.on(Context.MOB_SPAWNED, ({ mob }) => {
      const { category } = Entities[mob?.type] ?? {}
      if (category !== 'npc')
        visible_mobs[mob.entity_id] = mob
    })
    events.on(Context.MOB_DESPAWNED, ({ entity_id }) => {
      if (entity_id in visible_mobs)
        delete visible_mobs[entity_id]
    })

    client.on('use_item', ({ hand }) => {
      if (hand === Hand.MAINHAND) {
        const { inventory, held_slot_index, position } = get_state()
        const slot_number = held_slot_index + HOTBAR_OFFSET
        const item = inventory[slot_number]
        const state = get_state()
        if (item && state.health > 0) {
          const { type } = item
          const itemData = Items[type]
          if (itemData.type === 'weapon' && itemData.item === 'bow') {
            const direction = to_direction(position.yaw, position.pitch)
            const pos = {...position, y: position.y+1}
            const velocity = { x: direction.x*6000, y: direction.y*4000, z: direction.z*6000 }
            const wall_predict = get_path_collision(world, position, velocity, 60)
            wall_predict.then((result) => {
              events.emit(Context.SHOOT, {sender: client, position: pos, velocity, wall_predict: result})
            })
          }
        }
      }
    }
  )}
}