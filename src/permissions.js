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

export function can_interract_with_npcs({ soul = undefined } = {}) {
  // a ghost can't interact with npcs
  if (!soul) return false

  return true
}

export function can_use_teleportation_stone({ soul = undefined } = {}) {
  // a ghost can't use teleportation stones
  if (!soul) return false

  return true
}
