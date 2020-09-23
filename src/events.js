export function position_change_event({ client, events, position }) {
  function onPosition({
    x,
    y,
    z,
    onGround,
    yaw = position.yaw,
    pitch = position.pitch,
  }) {
    client.off('position', onPosition)
    client.off('position_look', onPosition)

    const next = { x, y, z, yaw, pitch }

    events.emit('position_change', {
      last: position,
      next,
    })

    position_change_event({ client, events, position: next })
  }

  client.on('position', onPosition)
  client.on('position_look', onPosition)
}
