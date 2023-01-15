import EventEmitter from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'

export const PlayerAction = {
  /** the player is receiving raw damage */
  RECEIVE_DAMAGE: 'PLAYER:ACTION:RECEIVE_DAMAGE',
  /** the player's health needs an update */
  UPDATE_HEALTH: 'PLAYER:ACTION:UPDATE_HEALTH',
  /** the player needs to be teleported */
  TELEPORT_TO: 'PLAYER:ACTION:TELEPORT_TO',
  /** the player needs to receive a new item */
  LOOT_ITEM: 'PLAYER:ACTION:LOOT_ITEM',
  PICK_ITEM: 'PLAYER:ACTION:PICK_ITEM', // TODO: deprecate (no items will be on the ground on ares)
  /** the soul of player should regenerate a bit */
  REGENERATE_SOUL: 'PLAYER:ACTION:REGENERATE_SOUL',
  /** the player should die */
  DIE: 'PLAYER:ACTION:DIE',
  /** the inventory of the player should be resynced */
  RESYNC_INVENTORY: 'PLAYER:ACTION:RESYNC_INVENTORY',
  /** the gamemode of the player should be updated */
  SWITCH_GAMEMODE: 'PLAYER:ACTION:SWITCH_GAMEMODE',
  /** the player should receive experience */
  RECEIVE_EXPERIENCE: 'PLAYER:ACTION:RECEIVE_EXPERIENCE',
}

export const PlayerEvent = {
  /** the player state has been updated */
  STATE_UPDATED: 'PLAYER:EVENT:STATE_UPDATED',
  /** the player interracted with a screen */
  SCREEN_INTERRACTED: 'PLAYER:EVENT:SCREEN_INTERRACTED',
  /** a chunk has been loaded */
  CHUNK_LOADED: 'PLAYER:EVENT:CHUNK_LOADED',
  /** a chunk has been unloaded */
  CHUNK_UNLOADED: 'PLAYER:EVENT:CHUNK_UNLOADED',
  /** a chunk has been loaded with mobs */
  CHUNK_LOADED_WITH_MOBS: 'PLAYER:EVENT:CHUNK_LOADED_WITH_MOBS',
  /** a chunk has been unloaded with mobs */
  CHUNK_UNLOADED_WITH_MOBS: 'PLAYER:EVENT:CHUNK_UNLOADED_WITH_MOBS',
  /** a mob is now visible by the player */
  MOB_ENTER_VIEW: 'PLAYER:EVENT:MOB_ENTER_VIEW',
  /** a mob is not visible anymore by the player */
  MOB_LEAVE_VIEW: 'PLAYER:EVENT:MOB_LEAVE_VIEW',
  /** a mob visible by the player took damage */
  MOB_DAMAGED: 'PLAYER:EVENT:MOB_DAMAGED',
  /** a mob visible by the player just died */
  MOB_DEATH: 'PLAYER:EVENT:MOB_DEATH',
  /** the player launched a projectile */
  LAUNCH_PROJECTILE: 'PLAYER:EVENT:LAUNCH_PROJECTILE',
}

export const MobAction = {
  /** a mob is receiving */
  RECEIVE_DAMAGE: 'MOB:ACTION:RECEIVE_DAMAGE',
  /** a mob is going toward a position */
  GOTO: 'MOB:ACTION:GOTO',
  END_PATH: 'MOB:ACTION:END_PATH',
  TARGET_POSITION: 'MOB:ACTION:TARGET_POSITION',
  WAKE_UP: 'MOB:ACTION:WAKE_UP',
}

export const MobEvent = {
  /** a mob state has been updated */
  STATE_UPDATED: 'MOB:EVENT:STATE_UPDATED',
}

// export const ProjectileAction = {
//   SPAWN_NEXT: 'PROJECTILE:ACTION:SPAWN_NEXT',
//   // KILL_INSTANCE: 'PROJECTILE:ACTION:KILL_INSTANCE',
// }

// export const ProjectileEvent = {
//   /** a projectile state has been updated */
//   STATE_UPDATED: 'PROJECTILE:EVENT:STATE_UPDATED',
//   // SPAWN_INSTANCE: 'PROJECTILE:EVENT:SPAWN_INSTANCE',
//   // DESPAWN_INSTANCE: 'PROJECTILE:EVENT:DESPAWN_INSTANCE',
// }

export const ProjectileInstanceEvent = {
  STATE_UPDATED: 'PROJECTILE_INSTANCE:EVENT:STATE_UPDATED',
  HIT_OBJECT: 'PROJECTILE_INSTANCE:EVENT:HIT_OBJECT',
  SPAWN: 'PROJECTILE_INSTANCE:EVENT:SPAWN',
  DESPAWN: 'PROJECTILE_INSTANCE:EVENT:DESPAWN',
}

export const ProjectileInstanceAction = {
  INIT: 'PROJECTILE_INSTANCE:ACTION:INIT',
  UPDATE_MOVEMENT: 'PROJECTILE_INSTANCE:ACTION:UPDATE_MOVEMENT',
  KILL: 'PROJECTILE_INSTANCE:ACTION:KILL',
}

export const WorldRequest = {
  /** a new player joined the world */
  ADD_PLAYER_TO_WORLD: 'WORLD:ADD_PLAYER_TO_WORLD',
  /** an user is sending a message in the chat */
  SEND_CHAT_MESSAGE: 'WORLD:SEND_CHAT_MESSAGE',
  /** an user is sending a private message to another player */
  SEND_PRIVATE_MESSAGE: 'WORLD:SEND_PRIVATE_MESSAGE',
  /** reach a specific player to notify him of the current observed player presence */
  NOTIFY_PRESENCE_TO: uuid => `WORLD:ADD_PLAYER_${uuid}`,
  /** a chunk position should be updated */
  CHUNK_POSITION_UPDATE: chunk_index => `WORLD:POSITION_${chunk_index}`,
}

export function last_event_value(emitter, event) {
  let value = null
  emitter.on(event, new_value => (value = new_value))
  return () => value
}

export function create_state(
  { state_event, initial_state, state_reducer },
  context
) {
  const actions = new PassThrough({ objectMode: true })
  const events = new EventEmitter()
  events.setMaxListeners(Infinity)

  aiter(actions).reduce(async (last_state, action) => {
    const state = await state_reducer(last_state, action, context())
    events.emit(state_event, state)
    return state
  }, initial_state)

  setImmediate(() => events.emit(state_event, initial_state))

  const get_state = last_event_value(events, state_event)

  return {
    events,
    get_state,
    dispatch(action_type, payload, time = Date.now()) {
      actions.write({ type: action_type, payload, time })
    },
    reset() {
      setImmediate(() => events.emit(state_event, initial_state))
    },
  }
}
