import { chunk_index, chunk_position } from '../chunk.js'

export function look_player({ client, world }) {
  client.on('position', ({ x, y, z, onGround }) => {
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
    for (const i in x_chunks) {
      for (const j in z_chunks) {
        for (const k in traders_in_chunk.get(
          chunk_index(x_chunks[i], z_chunks[j])
        )) {
          const entity = traders_in_chunk.get(
            chunk_index(x_chunks[i], z_chunks[j])
          )[k]
          const yaw = Math.min(
            127,
            Math.max(
              -128,
              -((Math.atan2(x - entity.x, z - entity.z) / Math.PI / 2) * 255)
            )
          )
          const target = entity.id
          client.write('entity_head_rotation', {
            entityId: target,
            headYaw: yaw,
          })
          client.write('entity_look', {
            entityId: target,
            yaw,
            pitch: 0,
            onGround: true,
          })
        }
      }
    }
  })
}
