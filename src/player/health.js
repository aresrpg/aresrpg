import { on } from 'events'

import { aiter } from 'iterator-helper'

export default {
  observer({ client, events, dispatch, get_state }) {
    const reducer = (last_health, [{ health }]) => {
      if (last_health !== health) {
        console.dir({
          health,
          food: 20,
          foodSaturation: 0,
        })
        client.write('update_health', {
          health,
          food: 20,
          foodSaturation: 0,
        })
      }
      return health
    }
    aiter(on(events, 'state')).reduce(reducer, get_state().health)
  },
}
