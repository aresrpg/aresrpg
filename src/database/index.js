import Clients from './redis.js'

// Add here all fields that you want to save in the database
const serialize = ({
  position,
  teleport,
  view_distance,
  inventory,
  damage_indicators,
  inventory_sequence_number,
  inventory_cursor,
  inventory_cursor_index,
  game_mode,
  experience,
  health,
}) =>
  JSON.stringify({
    position,
    view_distance,
    inventory,
    game_mode,
    experience,
    health,
  })

export default (client) => ({
  push: async (state) => {
    // TODO: maybe implement a way to only push changes and not the whole state everytime
    // @see https://oss.redis.com/redisjson/path/
    return Clients.write.call(
      'JSON.SET',
      client.uuid.toLowerCase(),
      '.',
      serialize(state)
    )

    // we should also trigger a redis subscription here to sync all nodes
  },
  pull: async () => {
    const state = await Clients.read.call('JSON.GET', client.uuid.toLowerCase())
    return JSON.parse(state)
  },
})
