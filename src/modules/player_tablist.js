import { WorldRequest } from '../core/events.js'
import { synchronisation_payload } from '../core/sync.js'

/** @type {import('../server').Module} */
export default {
  name: 'player_tablist',
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

    const remove_player = ({ uuid }) => {
      if (uuid !== client.uuid)
        client.write('player_info', {
          action: 4,
          data: [{ UUID: uuid }],
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
      world.events.emit(WorldRequest.REMOVE_PLAYER_FROM_WORLD, {
        uuid: client.uuid,
      })
    })

    events.once('STATE_UPDATED', state => {
      // listening to request intended to us from a new player joining
      world.events.on(WorldRequest.NOTIFY_PRESENCE_TO(client.uuid), add_player)
      // listening to new players joining
      world.events.on(WorldRequest.ADD_PLAYER_TO_WORLD, on_player)
      // listening to players leaving
      world.events.on(WorldRequest.REMOVE_PLAYER_FROM_WORLD, remove_player)
      // send my infos to the world
      world.events.emit(WorldRequest.ADD_PLAYER_TO_WORLD, player_info(state))
    })
  },
}
