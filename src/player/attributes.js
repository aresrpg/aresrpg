import { PLAYER_ENTITY_ID } from '../index.js'

export default {
  observer({ client, events }) {
    events.once('state', () => {
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
