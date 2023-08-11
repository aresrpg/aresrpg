import { distance2d_squared } from './math.js'

const PLAYER_ZONE_DISTANCE = 30

/**
 * Return the closest teleportation stone from the player
 * @param {*} world
 * @returns {stones} name of the teleportation stone
 */
export function closest_stone(world, player_position) {
  const stones = world.teleportation_stones
  return stones.find(
    stone =>
      Math.sqrt(distance2d_squared(stone.position, player_position)) <=
      PLAYER_ZONE_DISTANCE,
  )
}
