import { path_types } from './plugin_channels.js'

function sorted_insert(array, sort_key, value) {
  const index = array.findIndex(e => e[sort_key] > value[sort_key])

  array.splice(index, 0, value)
}

function reconstruct_path(end) {
  const path = []
  let node = end

  while (node) {
    path.push({ ...node.node, cost: node.cost, distance: node.distance })
    node = node.parent
  }

  return path.reverse()
}

export async function pathfinding({
  start,
  is_target,
  neighbors,
  heuristic,
  equal,
  max_depth = 100,
}) {
  const open = [{ cost: 0, distance: heuristic(start), node: start }]
  const closed = []

  const insert = sorted_insert.bind(null, open, 'distance')

  while (open.length > 0 && closed.length < max_depth) {
    const head = open.shift()

    if (is_target(head.node))
      return {
        open,
        closed,
        path: reconstruct_path(head),
      }

    for (const neighbor of await neighbors(head.node)) {
      const cost = head.cost + neighbor.cost
      const distance = cost + heuristic(neighbor)
      const visited = closed.some(
        ({ node, cost: closed_cost }) =>
          equal(node, neighbor) && closed_cost <= cost,
      )

      if (!visited) {
        const pending_index = open.findIndex(({ node }) =>
          equal(node, neighbor),
        )
        const pending = pending_index >= 0 && open[pending_index].cost <= cost

        if (!pending) {
          if (pending_index >= 0) open.splice(pending_index, 1)
          insert({ cost, distance, node: neighbor, parent: head })
        }
      }
    }

    closed.push(head)
  }

  return { open, closed, path: null }
}

export function to_minecraft_path({ path, open, closed }) {
  const nodes = path.map(({ x, y, z, cost, distance }) => ({
    x,
    y,
    z,
    origin_distance: 0,
    cost_malus: cost,
    visited: true,
    type: path_types.WALKABLE,
    target_distance: distance,
  }))

  const open_set = open.map(({ node: { x, y, z }, cost, distance }) => ({
    x,
    y,
    z,
    origin_distance: 0,
    cost_malus: cost,
    visited: true,
    type: path_types.OPEN,
    target_distance: distance,
  }))

  const closed_set = closed.map(({ node: { x, y, z }, cost, distance }) => ({
    x,
    y,
    z,
    origin_distance: 0,
    cost_malus: cost,
    visited: true,
    type: path_types.WALKABLE,
    target_distance: distance,
  }))

  const target = nodes[nodes.length - 1]

  return {
    reached: false,
    current_path_index: 0,
    targets: [target],
    target,
    nodes,
    open_set,
    closed_set,
  }
}
