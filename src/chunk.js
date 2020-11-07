export const chunk_position = (value) => Math.floor(value / 16)

export function same_chunk(first_position, second_position) {
  const first_chunk_x = chunk_position(first_position.x)
  const first_chunk_z = chunk_position(first_position.z)
  const second_chunk_x = chunk_position(second_position.x)
  const second_chunk_z = chunk_position(second_position.z)

  const same_x = first_chunk_x === second_chunk_x
  const same_z = first_chunk_z === second_chunk_z

  return same_x && same_z
}
