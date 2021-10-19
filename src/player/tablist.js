import { Context, World } from '../events.js'

export default {
  observe({ world, client, events, get_state }) {
    const player_info = position => ({
      UUID: client.uuid,
      name: client.username,
      properties: client.profile?.properties ?? [],
      gamemode: 2,
      ping: client.latency,
      position,
    })

    const add_player = info => {
      client.write('player_info', {
        action: 0,
        data: [info],
      })
    }
    world.events.on(World.ADD_PLAYER(client.uuid), add_player)

    const on_player = info => {
      // Add player to tab list
      world.events.emit(World.ADD_PLAYER(client.uuid), info)
      if (info.UUID !== client.uuid) {
        // Send my info to new player
        world.events.emit(
          World.ADD_PLAYER(info.UUID),
          player_info(get_state().position)
        )
      }
    }
    world.events.on(World.PLAYER, on_player)

    client.once('end', () => {
      world.events.off(World.ADD_PLAYER(client.uuid), add_player)
      world.events.off(World.PLAYER, on_player)
    })

    events.once(Context.STATE, ({ position }) => {
      world.events.emit(World.PLAYER, player_info(position))
    })
  },
}
