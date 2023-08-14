import { on } from 'events'

import { aiter, iter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import logger from '../logger.js'
import { events_interceptor } from '../core/modules.js'

const log = logger(import.meta)

function modules_difference(from, to) {
  return from.filter(
    ({ name: from_name }) =>
      !to.some(({ name: to_name }) => from_name === to_name),
  )
}

/** @type {import('../server').Module} */
export default {
  name: 'player_modules',
  reduce(state, { type, payload }) {
    if (type === 'LOAD_GAME_STATE') return { ...state, game_state: payload }
    return state
  },
  // this module allows the player to enable and disable other modules
  observe({ client, events, world, signal, ...context }, observables) {
    // when we receive a MODULES event, we need to enable or disable modules
    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([{ game_state }]) => game_state)
      .reduce(
        async ({ game_state: last_game_state, loaded_modules }, game_state) => {
          if (last_game_state !== game_state) {
            const next_modules = observables[game_state] ?? []

            const modules_to_load = modules_difference(
              next_modules,
              loaded_modules,
            )
            const modules_to_unload = modules_difference(
              loaded_modules,
              next_modules,
            )

            iter(modules_to_unload)
              .filter(({ observe }) => !!observe)
              .forEach(({ controller, name }) => {
                log.warn({ module: name }, 'Unloading module')
                controller.abort()
              })

            const newly_loaded_modules = await iter(modules_to_load)
              .filter(({ observe }) => !!observe)
              .toAsyncIterator()
              .map(async module => {
                log.warn({ module: module.name }, 'Loading module')

                // we need to create a new controller for the module
                const controller = new AbortController()
                const proxied_events = events_interceptor(events)
                const proxied_client = events_interceptor(client)
                const proxied_world = events_interceptor(
                  world.mobs_positions_emitter,
                )

                // when the global controller is aborted, we simply abort the local controller
                // as everything will be garbage collected, we don't need to do anything else
                const handle_global_abort = () => controller.abort()
                signal.addEventListener('abort', handle_global_abort, {
                  once: true,
                })

                // when the local controller is aborted (which means the module was unloaded)
                controller.signal.addEventListener(
                  'abort',
                  () => {
                    // we need to remove all local listeners that were added to the client
                    proxied_client.remove_all_intercepted_listeners()
                    // and all local listeners that were added to the global events
                    proxied_events.remove_all_intercepted_listeners()
                    // and all local listeners that were added to the world
                    proxied_world.remove_all_intercepted_listeners()
                    // lastly we remove the listener from the global signal as we don't need it anymore
                    signal.removeEventListener('abort', handle_global_abort)
                  },
                  { once: true },
                )

                await module.observe({
                  ...context,
                  client: proxied_client,
                  events: proxied_events,
                  signal: controller.signal,
                  world: {
                    ...world,
                    mobs_positions_emitter: proxied_world,
                  },
                })

                return {
                  ...module,
                  controller,
                }
              })
              .toArray()

            return {
              game_state,
              loaded_modules: [
                ...modules_difference(loaded_modules, modules_to_unload),
                ...newly_loaded_modules,
              ],
            }
          }

          return { game_state, loaded_modules }
        },
        {
          game_state: null,
          loaded_modules: [],
        },
      )
  },
}
