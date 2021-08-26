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
    world.events.on(`add_player_${client.uuid}`, add_player)

    const on_player = info => {
      // Add player to tab list
      world.events.emit(`add_player_${client.uuid}`, info)
      if (info.UUID !== client.uuid) {
        // Send my info to new player
        world.events.emit(
          `add_player_${info.UUID}`,
          player_info(get_state().position)
        )
      }
    }
    world.events.on('player', on_player)

    client.once('end', () => {
      world.events.off(`add_player_${client.uuid}`, add_player)
      world.events.off('player', on_player)
    })

    events.once('state', ({ position }) => {
      world.events.emit('player', player_info(position))
    })
  },
}
