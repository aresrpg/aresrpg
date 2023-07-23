import { GameMode } from './gamemode.js'

export function can_receive_damage({
  game_mode = undefined,
  soul = undefined,
} = {}) {
  // a creative player can't take damage
  if (game_mode === GameMode.CREATIVE) return false
  // a ghost can't take damage
  if (!soul) return false

  return true
}

export function can_interract_with_entities({ soul, health }) {
  // a ghost can't interact with entities
  if (!soul) return false
  // a dead player can't interract with entities
  if (!health) return false

  return true
}

export function can_use_teleportation_stone({ soul }) {
  // a ghost can't use teleportation stones
  if (!soul) return false

  return true
}
