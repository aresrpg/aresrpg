import { chunk_position } from './chunk.js'
import { is_inside } from './math.js'

export function inside_view(get_state) {
  return position => {
    if (position) {
      const { view_distance, position: player_position } = get_state()

      const player_chunk_x = chunk_position(player_position.x)
      const player_chunk_z = chunk_position(player_position.z)

      const chunk_x = chunk_position(position.x)
      const chunk_z = chunk_position(position.z)

      return is_inside(
        {
          min: {
            x: player_chunk_x - view_distance,
            y: player_chunk_z - view_distance,
          },
          max: {
            x: player_chunk_x + view_distance,
            y: player_chunk_z + view_distance,
          },
        },
        { x: chunk_x, y: chunk_z }
      )
    }

    return false
  }
}
