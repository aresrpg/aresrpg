import { PlayerEvent, WorldRequest } from '../events.js'
import { synchronisation_payload } from '../sync.js'

export default {
  observe({ world, client, events, get_state }) {
    const player_info = state => ({
      properties: client.profile?.properties ?? [],
      latency: client.latency,
      ...synchronisation_payload(client, state),
    })

    const add_player = ({ uuid, username, properties, latency, position }) => {
      client.write('player_info', {
        action: 0,
        data: [
          {
            UUID: uuid,
            name: username,
            properties,
            gamemode: 2,
            ping: latency,
            position,
          },
        ],
      })
    }

    const on_player = info => {
      // Send infos of that new player to myself
      world.events.emit(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), info)
      if (info.uuid !== client.uuid) {
        // Send my infos to that new player
        setImmediate(() =>
          world.events.emit(
            WorldRequest.NOTIFY_PRESENCE_TO(info.uuid),
            player_info(get_state()),
          ),
        )
      }
    }

    client.once('end', () => {
      world.events.off(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), add_player)
      world.events.off(WorldRequest.ADD_PLAYER_TO_WORLD, on_player)
    })

    events.once(PlayerEvent.STATE_UPDATED, state => {
      world.events.on(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), add_player)
      world.events.on(WorldRequest.ADD_PLAYER_TO_WORLD, on_player)
      world.events.emit(WorldRequest.ADD_PLAYER_TO_WORLD, player_info(state))
    })
  },
}
