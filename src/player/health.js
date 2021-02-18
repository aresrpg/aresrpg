import { on } from 'events'

import { aiter } from 'iterator-helper'

export default {
  /** @type {import('../index.js').Observer} */
  observe({ client, events }) {
    aiter(on(events, 'state')).reduce((last_health, [{ health }]) => {
      if (last_health !== health) {
        client.write('update_health', {
          health,
          food: 20,
          foodSaturation: 0.0,
        })
      }
      return health
    }, 0)
  },
}
