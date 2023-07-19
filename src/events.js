export function last_event_value(emitter, event) {
  let value = null
  emitter.on(event, new_value => (value = new_value))
  return () => value
}

/** Local events which can be
 * - emited and then listened
 * - dispatched and then reduced
 */
export const PlayerEvent = {
  /** the player state has been updated */
  STATE_UPDATED: 'PLAYER:STATE_UPDATED',
  /** the player interracted with a screen */
  SCREEN_INTERRACTED: 'PLAYER:SCREEN_INTERRACTED',
  /** a chunk has been loaded */
  CHUNK_LOADED: 'PLAYER:CHUNK_LOADED',
  /** a chunk has been unloaded */
  CHUNK_UNLOADED: 'PLAYER:CHUNK_UNLOADED',
  /** a chunk has been loaded with mobs */
  CHUNK_LOADED_WITH_MOBS: 'PLAYER:CHUNK_LOADED_WITH_MOBS',
  /** a chunk has been unloaded with mobs */
  CHUNK_UNLOADED_WITH_MOBS: 'PLAYER:CHUNK_UNLOADED_WITH_MOBS',
  /** a mob is now visible by the player */
  MOB_ENTER_VIEW: 'PLAYER:MOB_ENTER_VIEW',
  /** a mob is not visible anymore by the player */
  MOB_LEAVE_VIEW: 'PLAYER:MOB_LEAVE_VIEW',
  /** a mob visible by the player took damage */
  MOB_DAMAGED: 'PLAYER:MOB_DAMAGED',
  /** a mob visible by the player just died */
  MOB_DEATH: 'PLAYER:MOB_DEATH',
  /** the player interracted with another player */
  PLAYER_INTERRACTED: 'PLAYER:PLAYER_INTERRACTED',
  /** the player is receiving raw damage, this is not a direct
   * health update as damage reduction may be applied, or canceled according to the gamemode
   */
  RECEIVE_DAMAGE: 'PLAYER:RECEIVE_DAMAGE',
  /** the player's health needs a direct update,
   * this will bypass any armor or gamemode
   */
  UPDATE_HEALTH: 'PLAYER:UPDATE_HEALTH',
  /** the player needs to be teleported */
  TELEPORT_TO: 'PLAYER:TELEPORT_TO',
  /** the player needs to receive a new item */
  LOOT_ITEM: 'PLAYER:LOOT_ITEM',
  PICK_ITEM: 'PLAYER:ACTION:PICK_ITEM', // TODO: deprecate (no items will be on the EVENT ares)
  /** the soul of player should regenerate a bit */
  REGENERATE_SOUL: 'PLAYER:REGENERATE_SOUL',
  /** the player should die */
  DIE: 'PLAYER:DIE',
  /** the inventory of the player should be resynced */
  RESYNC_INVENTORY: 'PLAYER:RESYNC_INVENTORY',
  /** the gamemode of the player should be updated */
  SWITCH_GAMEMODE: 'PLAYER:SWITCH_GAMEMODE',
  /** the player should receive experience */
  RECEIVE_EXPERIENCE: 'PLAYER:RECEIVE_EXPERIENCE',
  /** save the player's head texture */
  STORE_HEAD_TEXTURE: 'PLAYER:STORE_HEAD_TEXTURE',
  /** some settings of the player should be updated */
  UPDATE_SETTINGS: 'PLAYER:UPDATE_SETTINGS',
  /** player switched hotbar slot */
  SWITCH_SPELL: 'PLAYER:SWITCH_SPELL',
  /** player casting a spell */
  CAST_SPELL: 'PLAYER:CAST_SPELL',
}

export const MobEvent = {
  /** a mob state has been updated */
  STATE_UPDATED: 'MOB:STATE_UPDATED',
  /** a mob is receiving damages */
  RECEIVE_DAMAGE: 'MOB:RECEIVE_DAMAGE',
  /** a mob is going toward a position */
  GOTO: 'MOB:GOTO',
  END_PATH: 'MOB:END_PATH',
  TARGET_POSITION: 'MOB:TARGET_POSITION',
  WAKE_UP: 'MOB:WAKE_UP',
}

/** World events meant to be used in synchronizations */
export const WorldRequest = {
  /** a new player joined the world */
  ADD_PLAYER_TO_WORLD: 'WORLD:ADD_PLAYER_TO_WORLD',
  /** an user is sending a message in the chat */
  SEND_CHAT_MESSAGE: 'WORLD:SEND_CHAT_MESSAGE',
  /** an user is sending a private message to another player */
  SEND_PRIVATE_MESSAGE: 'WORLD:SEND_PRIVATE_MESSAGE',
  /** reach a specific player to notify him of the current observed player presence */
  NOTIFY_PRESENCE_TO: uuid => `WORLD:NOTIFY_PRESENCE_TO_${uuid}`,
  /** a player's position should be updated */
  POSITION_UPDATE: chunk_index => `WORLD:POSITION_${chunk_index}`,
  /**
   * a player's chunk position should be update
   * this event only compare chunk positions instead of raw position,
   * which greatly reduce the calls
   */
  CHUNK_POSITION_UPDATE: chunk_index => `WORLD:CHUNK_POSITION_${chunk_index}`,
  /**
   * A player is receiving damage (or heal) from an external event, like from another player.
   * It is important to receive the action of "being inflicted damage" to be able to reduce/cancel those damages.
   * TODO: it's a bit tricky for life_steal damages as we should be aware of the final inflicted damage to steal properly
   */
  PLAYER_RECEIVE_DAMAGE: 'WORLD:PLAYER_RECEIVE_DAMAGE',
  /** the health of another player was updated */
  PLAYER_HEALTH_UPDATE: 'WORLD:PLAYER_HEALTH_UPDATE',
  /** a player just died */
  PLAYER_DIED: 'WORLD:PLAYER_DIED',
  /** a player just respawned */
  PLAYER_RESPAWNED: 'WORLD:PLAYER_RESPAWNED',
  /**
   * a player updated his equiped items,
   * we notify the world that it should update the displayed inventory of that player
   */
  RESYNC_DISPLAYED_INVENTORY: 'WORLD:RESYNC_DISPLAYED_INVENTORY',
  /** a player is sneaking */
  PLAYER_SNEAKING: 'WORLD:PLAYER_SNEAKING',
}
