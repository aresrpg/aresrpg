import { on } from 'events'

import { aiter, iter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import logger from '../logger.js'
import { events_interceptor } from '../core/modules.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  reduce(state, { type, payload }) {
    if (type === 'LOAD_GAME_STATE') return { ...state, game_state: payload }
    return state
  },
  // this module allows the player to enable and disable other modules
  observe({ client, events, signal, ...context }, observables) {
    // when we receive a MODULES event, we need to enable or disable modules
    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([{ game_state }]) => game_state)
      .reduce(
        async (
          { game_state: last_game_state, controller: last_controller },
          game_state,
        ) => {
          if (last_game_state !== game_state) {
            if (last_game_state) {
              log.warn(
                {
                  game_state: last_game_state,
                  modules: observables[last_game_state].length,
                },
                'Unloading game state',
              )
              // if we were already observing a game state, we need to abort it
              last_controller.abort()
            }

            log.warn(
              { game_state, modules: observables[game_state].length },
              'Loading game state',
            )

            // we need to create a new controller for the new game state
            const controller = new AbortController()
            const proxied_events = events_interceptor(events)
            const proxied_client = events_interceptor(client)

            // when the global signal is aborted, we need to abort the observer
            // this happens when the client disconnects
            signal.addEventListener('abort', () => controller.abort(), {
              once: true,
            })

            // when the game state is unloaded
            controller.signal.addEventListener('abort', () => {
              // we need to remove all listeners that were added to the client by modules
              proxied_client.remove_all_intercepted_listeners()
              // and all listeners that were added to the global events emitter by modules
              proxied_events.remove_all_intercepted_listeners()
              // note that we don't need to remove the abort listener from the global signal as it is a once listener
            })

            const modules = observables[game_state]

            await iter(modules)
              .filter(({ observe }) => !!observe)
              .toAsyncIterator()
              .forEach(async ({ observe }) =>
                observe({
                  ...context,
                  client: proxied_client,
                  events: proxied_events,
                  signal: controller.signal,
                }),
              )

            return { game_state, controller }
          }
          return {
            game_state: last_game_state,
            controller: last_controller,
          }
        },
        {
          game_state: null,
          controller: null,
        },
      )
  },
}
