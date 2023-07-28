export function last_event_value(emitter, event) {
  let value = null
  emitter.on(event, new_value => (value = new_value))
  return () => value
}

// TODO: create types for the world emitter and remove this
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
