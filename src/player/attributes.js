export default {
  observer({ client, events }) {
    events.once('state', ({ entity_id }) => {
      client.write('entity_update_attributes', {
        entityId: entity_id,
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
