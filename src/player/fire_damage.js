import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import Vec3 from 'vec3'

import { get_block } from '../chunk.js'
import { Action } from '../events.js'
import { abortable } from '../iterator.js'

export async function getDamageSource(world, location) {
  const cursor = Vec3([0, 0, 0])
  const width = 0.6 // player bb width
  const height = 1.8 // player bb height //TODO: sneaking
  let bestDamageSource
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
          const damageType = Object.keys(damageSource).find(key =>
            Object.keys(damageSource[key]).some(
              () => damageSource[key].block === name
            )
          )
          const source = damageSource[damageType]
          if (
            source !== undefined &&
            (bestDamageSource === undefined ||
              source.damage > bestDamageSource.damage)
          )
            bestDamageSource = source
        }
      }
    }
  }
  return bestDamageSource
}
const damageSource = {
  FIRE: {
    damage: 0.5,
    block: 'fire',
  },
  LAVA: {
    damage: 1,
    block: 'lava',
  },
}
export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, dispatch, events, signal }) {
    aiter(abortable(setInterval(1000, null, { signal }))).forEach(async () => {
      const { position } = get_state()
      const source = await getDamageSource(world, position)

      if (source !== undefined) {
        const { damage } = source
        dispatch(Action.DAMAGE, { damage })
      }
    })
  },
}
