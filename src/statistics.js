const CATEGORIES = {
  MINED: 0,
  CRAFTED: 1,
  USED: 2,
  BROKEN: 3,
  PICKED_UP: 4,
  DROPPED: 5,
  KILLED: 6,
  KILLED_BY: 7,
  CUSTOM: 8,
}

export function statistics({ client }) {
  client.on('client_command', (actionId) => {
    if (actionId.actionId === 1) {
      client.write('statistics', {
        /*
          You can add statistcs like this:
          {
            categoryId: CATEGORIES.MINED,
            statisticId: 1,
            value: 0,
          },
          'CategoryId' is the type of stats you want to enter you can use CATEGORIES enum for help.
          'StatisticId' is the id of the statistic. for a block, item, entity use they ids, for a custom
          one use the custom statistics ids you can see everythings Here: https://wiki.vg/Protocol#Statistics.
          'Value' is the value given to the player.
          */
        entries: [
          {
            categoryId: CATEGORIES.MINED,
            statisticId: 1,
            value: 0,
          },
        ],
      })
    }
  })
}
