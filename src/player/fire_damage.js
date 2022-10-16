import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import Vec3 from 'vec3'

import { get_block } from '../chunk.js'
import { Action, Context } from '../events.js'
import { abortable } from '../iterator.js'
export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, events, dispatch, signal, world }) {
    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      async ({ fireTicks }, [state]) => {
        const { position } = state
        const inFire = await isInFire(world, position)
        if (inFire) {
          if (fireTicks.ticks <= 0) {
            // TODO: set entity fire animation (entity metadata)
            applyFireDamage(dispatch)
            aiter(abortable(setInterval(1000, null, { signal })))
              .takeWhile(() => fireTicks.ticks > 1)
              .forEach(() => {
                applyFireDamage(dispatch)
                fireTicks.ticks--
              })
              .then(() => {
                fireTicks.ticks = 0
              })
          }
          fireTicks.ticks = 5
        }

        return { fireTicks }
      },
      { fireTicks: { ticks: 0 } }
    )
  },
}
export async function isInFire(world, location) {
  return await isBlockInsidePlayer(world, location, 'fire')
}
export function applyFireDamage(dispatch) {
  const damage = 2
  if (damage > 0) {
    dispatch(Action.DAMAGE, { damage })
  }
}
export async function isBlockInsidePlayer(world, location, blockName) {
  const cursor = Vec3([0, 0, 0])
  const width = 0.6 // player bb width
  const height = 1.8 // player bb height //TODO: sneaking
  const queryBB = {
    minX: location.x - width / 2,
    minY: location.y,
    minZ: location.z - width / 2,
    maxX: location.x + width / 2,
    maxY: location.y + height,
    maxZ: location.z + width / 2,
  }
  for (
    cursor.y = Math.floor(queryBB.minY);
    cursor.y <= Math.floor(queryBB.maxY);
    cursor.y++
  ) {
    for (
      cursor.z = Math.floor(queryBB.minZ);
      cursor.z <= Math.floor(queryBB.maxZ);
      cursor.z++
    ) {
      for (
        cursor.x = Math.floor(queryBB.minX);
        cursor.x <= Math.floor(queryBB.maxX);
        cursor.x++
      ) {
        const block = await get_block(world, cursor)
        if (block) {
          const { name } = block
          if (name === blockName) {
            return true
          }
        }
      }
    }
  }
  return false
}
