import { on } from 'events'

import { aiter } from 'iterator-helper'

import { Context } from '../events.js'
import { abortable } from '../iterator.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal }) {
    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      (last_health, [{ health }]) => {
        if (last_health !== health) {
          client.write('update_health', {
            health,
            food: 20,
            foodSaturation: 0.0,
          })
        }
        return health
      },
      0
    )
  },
}
