import { on } from 'events'

import { aiter } from 'iterator-helper'

import { get_block } from '../chunk.js'
import { Action, Context } from '../events.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'
const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Observer} */
  /* async observe({ client, get_state, events, dispatch, signal, world}) {
    aiter(abortable(
     // @ts-ignore
      combineAsyncIterators(
        on(events, Context.STATE, { signal }),
        setInterval(1000, [{ timer: true }], { signal })
      )
      ))
      .map(([{timer},]) => ({ timer }))
      .reduce(async ({ fireTicks },{ timer }) => {
          const { position } = get_state()
          const now = Date.now()
          const maxFireTicks = 1;
          const blockName = 'stone_brick_slab'
          const under = await get_block(world, position)
          if(timer){
            log.info("TIMER " + now)
            if(fireTicks >= 0){
              if(fireTicks > 0){
                applyFireDamage(dispatch)
                log.info("TIMER " + now)
              }
              
              fireTicks --
            }
          }else{
            if(fireTicks < 0){
              if(under.name === blockName){
                applyFireDamage(dispatch)
                setInterval(10000)
                setTimeout(10000)
                setImmediate(10000)
                log.info("RESPOUSSER " + now)
                fireTicks = 1

              }
            }
          }
          return {
            fireTicks
          }
        },
        { fireTicks: 0 }
      )
      
  }, */

  observe({ client, events, signal, dispatch, world }) {
    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      async ({ fireTicks, fire_handle }, [state]) => {
        const { position } = state
        const under = await get_block(world, position)
        const inFire = isInFire(under)
        if (fireTicks === 0 && !inFire) {
          log.info('Clearing interval')
          clearInterval(fire_handle)
          return { fireTicks: -1, fire_handle: undefined }
        } else if (fireTicks <= 0 && inFire) {
          log.info('New interval')
          applyFireDamage(dispatch)
          return {
            fireTicks: 1,
            fire_handle: setInterval(() => {
              if (fireTicks > 0) {
                applyFireDamage(dispatch)
                fireTicks--
              }
            }, 1000),
          }
        }

        return { fireTicks, fire_handle }
      },
      { fireTicks: -1, fire_handle: undefined }
    )
  },

  /* observe({ client, events, signal, dispatch, get_state, world }) {
    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ position, fireTicks }]) => ({
        position, fireTicks
      }))
      .reduce(async (fireTicks, { position }) => {
          const under = await get_block(world, position)
          log.info("OUT : " + fireTicks)
          if(isInFire(under) && fireTicks == 0){
            log.info("New interval")
            fireTicks = 10
            aiter(abortable(setInterval(1000, null, { signal })))
            .take(fireTicks)
            .asIndexedPairs()
            // invert
            .map(([index]) => fireTicks - index)
            .forEach(remaining => {
              fireTicks = remaining
              log.info("INSIDE : " + remaining)
            })
          }

        return fireTicks
      }, 0)
  }, */
}
export function isInFire(under) {
  return under.name === 'stone_brick_slab'
}
export function applyFireDamage(dispatch) {
  const damage = 2
  if (damage > 0) {
    dispatch(Action.DAMAGE, { damage })
  }
}
