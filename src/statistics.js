export function statistics({ client }) {
  client.on('client_command', (actionId) => {
    if (actionId.actionId === 1) {
      client.write('statistics', {
        entries: [
          {
            categoryId: 0,
            statisticId: 1,
            value: 15,
          },
        ],
      })
    }
  })
}
