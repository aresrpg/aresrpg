import { block_center_position, position_equal } from '../position.js'
import { pathfinding } from '../pathfinding.js'
import { get_block } from '../chunk.js'

const directions = [
  { x: -1, y: 0, z: 0, cost: 1 },
  { x: 1, y: 0, z: 0, cost: 1 },
  { x: 0, y: 0, z: -1, cost: 1 },
  { x: 0, y: 0, z: 1, cost: 1 },

  { x: -1, y: 0, z: -1, cost: Math.SQRT2 },
  { x: -1, y: 0, z: 1, cost: Math.SQRT2 },
  { x: 1, y: 0, z: -1, cost: Math.SQRT2 },
  { x: 1, y: 0, z: 1, cost: Math.SQRT2 },
]

export function neighbors(world) {
  return async ({ x, y, z }) => {
    const jump_height = 1

    return (
      await Promise.all(
        Array.from({
          length: jump_height * 2 + 1,
        })
          .flatMap((e, i) =>
            directions.map(dt => ({
              ...dt,
              x: x + dt.x,
              y: y + i - jump_height,
              z: z + dt.z,
            }))
          )
          .map(async point => [point, await is_walkable(world, point)])
      )
    )
      .filter(([point, walkable]) => walkable)
      .map(([point]) => point)
  }
}

export function diagonal_distance(a, b) {
  const D1 = 1
  const D2 = Math.SQRT2
  const D3 = Math.SQRT2

  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  const dz = Math.abs(a.z - b.z)

  const dmin = Math.min(dx, dy, dz)
  const dmax = Math.max(dx, dy, dz)
  const dmid = dx + dy + dz - dmin - dmax

  return (D3 - D2) * dmin + (D2 - D1) * dmid + D1 * dmax
}

export function horizontal_diagonal_distance(a, b) {
  return diagonal_distance({ ...a, y: 0 }, { ...b, y: 0 })
}

export async function is_walkable(world, { x, y, z }) {
  const under = await get_block(world, { x, y: y - 1, z })
  const block = await get_block(world, { x, y, z })
  const front = await get_block(world, { x, y: y + 1, z })

  return (
    under.boundingBox === 'block' &&
    block.boundingBox === 'empty' &&
    front.boundingBox === 'empty'
  )
}

export async function path_between({
  world,
  from,
  to,
  distance = 0,
  distance_fn = diagonal_distance,
}) {
  const start = block_center_position(from)
  const destination = block_center_position(to)

  return await pathfinding({
    start,
    is_target(node) {
      return distance_fn(node, destination) <= distance
    },
    neighbors: neighbors(world),
    heuristic(node) {
      return distance_fn(node, destination)
    },
    equal: position_equal,
  })
}
