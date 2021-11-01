export function last_event_value(emitter, event) {
  let value = null
  emitter.on(event, new_value => (value = new_value))
  return () => value
}

export const Action = {
  ENJIN: 'ENJIN',
  FALL_DAMAGE: 'FALL_DAMAGE',
  TELEPORT: 'TELEPORT',
  DAMAGE_INDICATOR: 'DAMAGE_INDICATOR',
  LOOT_ITEM: 'LOOT_ITEM',
  PICK_ITEM: 'PICK_ITEM',
}

export const Context = {
  STATE: 'STATE',
  CHUNK_LOADED: 'CHUNK_LOADED',
  CHUNK_UNLOADED: 'CHUNK_UNLOADED',
  CHUNK_LOADED_WITH_MOBS: 'CHUNK_LOADED_WITH_MOBS',
  CHUNK_UNLOADED_WITH_MOBS: 'CHUNK_UNLOADED_WITH_MOBS',
  MOB_SPAWNED: 'MOB_SPAWNED',
  MOB_DESPAWNED: 'MOB_DESPAWNED',
  MOB_DAMAGE: 'MOB_DAMAGE',
  MOB_DEATH: 'MOB_DEATH',
  SCREEN_INTERRACT: 'SCREEN_INTERRACT',
}

export const Mob = {
  STATE: 'STATE',
}

export const MobAction = {
  DEAL_DAMAGE: 'DAMAGE',
  GOTO: 'GOTO',
  PATH_ENDED: 'PATH_ENDED',
  TARGET_POSITION: 'TARGET_POSITION',
  WAKE_UP: 'WAKE_UP',
  POSITION: 'POSITION',
}

export const World = {
  CHAT: 'CHAT',
  PRIVATE_MESSAGE: 'PRIVATE_MESSAGE',
  PLAYER: 'PLAYER',
  ADD_PLAYER: uuid => `ADD_PLAYER_${uuid}`,
  CHUNK_POSITION: chunk_index => `POSITION_${chunk_index}`,
}
