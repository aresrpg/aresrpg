import graph from './graph.js'

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'database:load_player')
      return {
        ...state,
        ...payload,
      }

    return state
  },

  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    events.once('state', async (state) => {
      const { player } = await graph.run`
          MATCH (p:Player ${{ uuid: client.uuid }})
          RETURN p as player`

      if (player) {
        const {
          x,
          y,
          z,
          yaw,
          pitch,
          view_distance,
          game_mode,
          experience,
          health,
        } = player
        dispatch('database:load_player', {
          position: { x, y, z, yaw, pitch },
          view_distance,
          game_mode,
          experience,
          health,
        })
      }
    })
  },
}
