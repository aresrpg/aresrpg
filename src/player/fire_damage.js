import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import Vec3 from 'vec3'

import { get_block } from '../chunk.js'
import { Action, Context } from '../events.js'
import { abortable } from '../iterator.js'
/**
 * @returns true if the damage interval is working
 */
function isWorking(damageTicks) {
  return damageTicks.fireTicks > 0 || damageTicks.lavaTicks > 0
}
export async function isInFire(world, location) {
  return await isBlockInsidePlayer(world, location, 'fire')
}
export async function isInLava(world, location) {
  return await isBlockInsidePlayer(world, location, 'lava')
}
/**
 * Starts an interval that damage every seconds until fireticks or lavaticks is 0
 */
async function startDamage(dispatch, signal, damageTicks, lava = false) {
  lava ? applyLavaDamage(dispatch) : applyFireDamage(dispatch)
  aiter(abortable(setInterval(1000, null, { signal })))
    .takeWhile(() => damageTicks.fireTicks > 1 || damageTicks.lavaTicks > 1)
    .forEach(() => {
      if (damageTicks.lavaTicks > 1) {
        damageTicks.lavaTicks--
        damageTicks.fireTicks = 5
        applyLavaDamage(dispatch)
      } else if (damageTicks.fireTicks > 1) {
        damageTicks.fireTicks--
        applyFireDamage(dispatch)
      }
    })
    .then(() => {
      damageTicks.fireTicks = 0
      damageTicks.lavaTicks = 0
    })
}
export function applyFireDamage(dispatch) {
  const damage = 1
  if (damage > 0) {
    dispatch(Action.DAMAGE, { damage })
  }
}
export function applyLavaDamage(dispatch) {
  const damage = 2
  if (damage > 0) {
    dispatch(Action.DAMAGE, { damage })
  }
}
/**
 * @returns true if a specific block is inside player boundingbox
 */
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

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, events, dispatch, signal, world }) {
    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      async ({ damageTicks }, [state]) => {
        const { position } = state
        const inFire = await isInFire(world, position)
        const inLava = await isInLava(world, position)
        if (inLava) {
          if (!isWorking(damageTicks)) {
            // TODO: set entity fire animation (entity metadata)
            startDamage(dispatch, signal, damageTicks, true)
          }
          damageTicks.lavaTicks = 2
          damageTicks.fireTicks = 5
        } else {
          // out of lava
          if (damageTicks.lavaTicks > 0) {
            damageTicks.lavaTicks = 0
            if (!isWorking(damageTicks)) {
              startDamage(dispatch, signal, damageTicks)
            }
          }

          if (inFire) {
            if (!isWorking(damageTicks)) {
              startDamage(dispatch, signal, damageTicks)
            }
            damageTicks.fireTicks = 5
          }
        }

        return { damageTicks }
      },
      { damageTicks: { fireTicks: 0, lavaTicks: 0 } }
    )
  },
}
