const Categories = {
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

export default {
  observe({ client }) {
    client.on('client_command', (actionId) => {
      if (actionId.actionId === 1) {
        client.write('statistics', {
          /*
            You can add statistcs like this:
            {
              categoryId: Categories.MINED,
              statisticId: 1,
              value: 0,
            },
            'categoryId' is the type of stats you want to enter you can use Categories enum for help.
            'statisticId' is the id of the statistic. for a block, item, entity use they ids, for a custom
            one use the custom statistics ids you can see everything listed here: https://wiki.vg/Protocol#Statistics.
            'value' is the value given to the player.
            */
          entries: [
            {
              categoryId: Categories.MINED,
              statisticId: 1,
              value: 0,
            },
          ],
        })
      }
    })
  },
}
