const Positions = {
  LIST: 0,
  SIDEBAR: 1,
  BELOW_NAME: 2,
}

const Actions = {
  CREATE_OBJECTIVE: 0,
  REMOVE_OBJECTIVE: 1,
  UPDATE_OBJECTIVE: 2,
  UPSERT_SCORE: 0,
  REMOVE_SCORE: 1,
}

const INTEGER_TYPE = 0

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {},

  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, signal, client }) {
    events.once('state', (state) => {
      client.write('scoreboard_objective', {
        name: 'dummy',
        action: Actions.CREATE_OBJECTIVE,
        displayText: JSON.stringify({ color: 'gold', text: 'Statistiques' }),
        type: INTEGER_TYPE,
      })
      client.write('scoreboard_display_objective', {
        name: 'dummy',
        position: Positions.SIDEBAR,
      })
    })
  },
}
