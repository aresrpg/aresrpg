import { PlayerEvent } from '../events.js'
import { PLAYER_ENTITY_ID } from '../settings.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events }) {
    events.once(PlayerEvent.STATE_UPDATED, () => {
      client.write('entity_update_attributes', {
        entityId: PLAYER_ENTITY_ID,
        properties: [
          {
            key: 'generic.max_health',
            value: 40,
            modifiers: [],
          },
        ],
      })
    })
  },
}
