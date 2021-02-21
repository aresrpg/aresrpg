import { chunk_index, chunk_position } from '../chunk.js'

export function look_player({ client, world, events }) {
  events.on('state', ({ position: { x, z } }) => {
    const { traders_in_chunk } = world.traders
    const x_chunks = [
      chunk_position(x) - 1,
      chunk_position(x),
      chunk_position(x) + 1,
    ]
    const z_chunks = [
      chunk_position(z) - 1,
      chunk_position(z),
      chunk_position(z) + 1,
    ]
    for (const i of x_chunks) {
      for (const j of z_chunks) {
        if (traders_in_chunk.has(chunk_index(i, j))) {
          for (const trader of traders_in_chunk.get(chunk_index(i, j))) {
            const yaw = Math.floor(
              (-Math.atan2(x - trader.x, z - trader.z) / Math.PI) * (255 / 2)
            )
            const entityId = trader.id
            client.write('entity_head_rotation', {
              entityId,
              headYaw: yaw,
            })
          }
        }
      }
    }
  })
}
