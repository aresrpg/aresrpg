import { chunk_index, chunk_position } from '../core/chunk.js'

/** @param {import('../world').LivingWorld} world */
export default function register_villager_traders(world) {
  const by_chunk = world.traders.reduce((map, { x, z, y, name }, i) => {
    const chunk_x = chunk_position(x)
    const chunk_z = chunk_position(z)
    const index = chunk_index(chunk_x, chunk_z)
    const entry = map.get(index) || []
    return new Map([
      ...map.entries(),
      [index, [...entry, { x, z, y, name, id: world.next_entity_id + i }]],
    ])
  }, new Map())

  const recipes = world.traders.map(({ recipes, name }, i) => {
    return { id: world.next_entity_id + i, recipes, name }
  })

  const windowIds = new Map(
    recipes.map(({ id, recipes, name }, i) => [
      id,
      {
        windowId: world.next_window_id + i,
        recipes,
        name,
      },
    ]),
  )

  return {
    ...world,
    next_entity_id: world.next_entity_id + world.traders.length,
    next_window_id: world.next_window_id + windowIds.size,
    traders_by_chunk: by_chunk,
    traders_window_ids: windowIds,
  }
}
