export const chunk_position = (value) => Math.floor(value / 16)

export function chunk_change_event({ events }) {
  events.on('position_change', ({ last, next }) => {
    const last_chunk_x = chunk_position(last.x)
    const last_chunk_z = chunk_position(last.z)
    const next_chunk_x = chunk_position(next.x)
    const next_chunk_z = chunk_position(next.z)

    const x_different = last_chunk_x !== next_chunk_x
    const z_different = last_chunk_z !== next_chunk_z

    if (x_different || z_different) {
      events.emit('chunk_change', {
        last: { x: last_chunk_x, z: last_chunk_z },
        next: { x: next_chunk_x, z: next_chunk_z },
      })
    }
  })
}
