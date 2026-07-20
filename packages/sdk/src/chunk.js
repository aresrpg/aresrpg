import spiral from 'spiralloop'

// Spatial partitioning for the world: positions are bucketed into fixed CHUNK_SIZE
// cells used as the unit of pub/sub locality + entity visibility (the synchronizer
// tracks/broadcasts per chunk). This is COORDINATE math only — the voxel chunk-DATA
// streaming (RLE/gzip block columns) was removed with the voxel terrain engine.

export const CHUNK_SIZE = 64

export function to_chunk_position(position) {
  const x = Math.floor(position.x / CHUNK_SIZE)
  const z = Math.floor(position.z / CHUNK_SIZE)

  return { x, z }
}

export function spiral_array(center, min_distance, max_distance) {
  const positions = []

  // Determine the size of the spiral needed based on maxDistance
  const size = max_distance * 2 + 1

  spiral([size, size], function (x, z) {
    // Adjust x and z to be relative to the center
    const adjusted_x = x - max_distance + center.x
    const adjusted_z = z - max_distance + center.z

    // Calculate Manhattan distance from the center
    const distance =
      Math.abs(center.x - adjusted_x) + Math.abs(center.z - adjusted_z)

    // Include positions within the specified distance range
    if (distance >= min_distance && distance <= max_distance) {
      positions.push({ x: adjusted_x, z: adjusted_z })
    }
  })

  return positions
}
