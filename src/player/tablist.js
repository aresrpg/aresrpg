import { PlayerEvent, WorldRequest } from '../events.js'

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

    const on_player = info => {
      // Add player to tab list
      world.events.emit(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), info)
      if (info.UUID !== client.uuid) {
        // Send my info to new player
        world.events.emit(
          WorldRequest.NOTIFY_PRESENCE_TO(info.UUID),
          player_info(get_state().position)
        )
      }
    }

    client.once('end', () => {
      world.events.off(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), add_player)
      world.events.off(WorldRequest.ADD_PLAYER_TO_WORLD, on_player)
    })

    events.once(PlayerEvent.STATE_UPDATED, ({ position }) => {
      world.events.on(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), add_player)
      world.events.on(WorldRequest.ADD_PLAYER_TO_WORLD, on_player)
      world.events.emit(WorldRequest.ADD_PLAYER_TO_WORLD, player_info(position))
    })
  },
}
