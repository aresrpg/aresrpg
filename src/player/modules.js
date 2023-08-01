import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { events_interceptor } from '../modules.js'

const log = logger(import.meta)

/** @type {import('../context.js').Module} */
export default {
  // this module allows the player to enable and disable other modules
  name: 'player_modules',
  observe({ client, events, signal, ...context }, modules) {
    // when we receive a MODULES event, we need to enable or disable modules
    aiter(abortable(on(events, 'MODULES', { signal })))
      .map(([modules_configuration]) => modules_configuration)
      .reduce(
        (last_modules, configuration) =>
          // returning a modified array of modules with new controllers for newly enabled modules
          last_modules.map(({ observe, controller, name, enabled }) => {
            // indicate that this module wasn't enabled but should be now
            const should_start = !enabled && configuration[name]
            // indicate that this module was enabled but should be disabled now
            const should_abort = enabled && configuration[name] === false

            if (should_start) {
              // we need to create a new controller for each observer each time we call enable on them
              const new_controller = new AbortController()
              const child_events_listeners = []
              const child_client_listeners = []
              // the proxy is used to intercept calls to addListener and removeListener
              // so that we may cleanup ressources when the observer is disabled
              const proxied_events = events_interceptor(
                events,
                child_events_listeners,
              )
              const proxied_client = events_interceptor(
                client,
                child_client_listeners,
              )

              // when the observer is disabled
              new_controller.signal.addEventListener('abort', () => {
                // we need to remove all listeners that were added to the client
                child_client_listeners.forEach(({ event_name, listener }) =>
                  client.removeListener(event_name, listener),
                )
                // and all listeners that were added to the events emitter
                child_events_listeners.forEach(({ event_name, listener }) =>
                  events.removeListener(event_name, listener),
                )
                //  note that we don't need to remove the abort listener from the global signal as it was added with the once option
              })

              // when the global signal is aborted, we need to abort the observer
              // this happens when the client disconnects
              signal.addEventListener('abort', () => new_controller.abort(), {
                once: true,
              })

              log.warn({ module: name }, 'Enabling module')

              // observing as usual except we replace the signal, events and client
              observe({
                ...context,
                events: proxied_events,
                client: proxied_client,
                signal: new_controller.signal,
              })

              return {
                observe,
                controller: new_controller,
                name,
                enabled: true,
              }
            }

            if (should_abort) {
              log.warn({ module: name }, 'Disabling module')
              controller.abort()
              return {
                observe,
                controller: null,
                name,
                enabled: false,
              }
            }

            return {
              observe,
              controller,
              name,
              enabled,
            }
          }),
        modules,
      )
  },
}
