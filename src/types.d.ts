import net from 'net'

declare module 'minecraft-protocol' {
  interface Server {
    socketServer: net.Server
  }

  interface Client {
    id: number
    write(packet: string, payload: any): void
    end(reason: string, fullReason: string): void
  }
}

declare module 'minecraft-data' {
  interface IndexedData {
    loginPacket: LoginPacket
  }
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never

type Await<T> = T extends Promise<infer U> ? U : T

type ItemBase = {
  id: string
  name: string
  type: string
  item: string
  custom_model_data: number
  enchanted: boolean
  description: string
  level: number
  critical?:
    | {
        outcomes: number
        bonus: number
      }
    | undefined
  damage?: {
    from: number
    to: number
    type: string
    element?: string
  }[]
}

type ItemStatisticsTemplate = {
  vitality: number[]
  mind: number[]
  strength: number[]
  intelligence: number[]
  chance: number[]
  agility: number[]
  speed: number[]
  reach: number[]
  haste: number[]
}

type ItemStatistics = {
  vitality: number | undefined
  mind: number | undefined
  strength: number | undefined
  intelligence: number | undefined
  chance: number | undefined
  agility: number | undefined
  speed: number | undefined
  reach: number | undefined
  haste: number | undefined
}

/** An item template is a static json object representing the schema of an item,
 * it is used to generate real items
 */
type ItemTemplate = ItemBase & {
  stats?: ItemStatisticsTemplate
}

/** Represent an item ready to be used, it has fixed stats and a count */
type Item = ItemBase & {
  stats?: ItemStatistics
  count: number
}

type EventMap = Record<string, any>

type EventName<T extends EventMap> = string & keyof T
type EventListener<T> = (arg: T) => void

interface TypedEmitter<T extends EventMap> {
  on<K extends EventName<T>>(eventName: K, listener: EventListener<T[K]>): this
  on(eventName: string | symbol, listener: (arg: any) => void): this

  once<K extends EventName<T>>(
    eventName: K,
    listener: EventListener<T[K]>,
  ): this
  once(eventName: string | symbol, listener: (arg: any) => void): this

  off<K extends EventName<T>>(eventName: K, listener: EventListener<T[K]>): this
  off(eventName: string | symbol, listener: (arg: any) => void): this

  emit<K extends EventName<T>>(eventName: K, arg: T[K]): boolean
  emit(eventName: string | symbol, arg: any): boolean

  setMaxListeners(number): this
}

type Dispatcher<T extends EventMap, K extends EventName<T>> = (
  type: K,
  payload: T[K],
) => void

declare module 'events' {
  interface StaticEventEmitterOptions {
    signal?: AbortSignal | undefined
  }

  function on(
    emitter: NodeJS.EventEmitter,
    eventName: string,
    options?: StaticEventEmitterOptions,
  ): AsyncIterableIterator<any>
  function on<T, K extends EventName<T>>(
    emitter: TypedEmitter<T>,
    eventName: K,
    options?: StaticEventEmitterOptions,
  ): AsyncIterableIterator<[T[K]]>
  function on<T>(
    emitter: TypedEmitter<T>,
    eventName: string,
    options?: StaticEventEmitterOptions,
  ): AsyncIterableIterator<any>

  class EventEmitter {
    static on(
      emitter: NodeJS.EventEmitter,
      eventName: string,
      options?: StaticEventEmitterOptions,
    ): AsyncIterableIterator<any>
    static on<T, K extends EventName<T>>(
      emitter: TypedEmitter<T>,
      eventName: K,
      options?: StaticEventEmitterOptions,
    ): AsyncIterableIterator<[T[K]]>
    static on<T>(
      emitter: TypedEmitter<T>,
      eventName: string,
      options?: StaticEventEmitterOptions,
    ): AsyncIterableIterator<any>
  }
}

type State = import('./context.js').State
type MobState = import('./mobs.js').MobState

// Local events which can be emited and then listened
type PlayerEvents = TypedEmitter<{
  STATE_UPDATED: State // the player state has been updated
  CHUNK_LOADED: { x: number; z: number; signal: AbortSignal } // a chunk has been loaded
  CHUNK_UNLOADED: { x: number; z: number; signal: AbortSignal } // a chunk has been unloaded
  SCREEN_INTERRACTED: { x: number; y: number; screen_id: string; hand: number } // the player interacted with a screen_id
  CHUNK_LOADED_WITH_MOBS: {
    mobs: any
    x: number
    z: number
    signal: AbortSignal
  } // a chunk has been loaded with mobs
  CHUNK_UNLOADED_WITH_MOBS: { mobs: any; x: number; z: number } // a chunk has been unloaded with mobs
  MOB_ENTER_VIEW: { mob: any; signal: AbortSignal } // a mob is now visible by the player
  MOB_LEAVE_VIEW: number // a mob is no longer visible by the player
  MOB_DAMAGED: { mob: any; damage: number; critical_hit: boolean } // a mob visible by the player took damage
  MOB_DEATH: { mob: any; critical_hit: boolean } // a mob visible by the player died
  PLAYER_INTERRACTED: {
    player: {
      uuid: string
      position: State['position']
      health: number
      username: string
      entity_id: number
    }
    mouse: number
  } // the player interacted with another player
  RECEIVE_DAMAGE: { damage: number } // the player is receiving raw damage, this is not a direct health update as damage reduction may be applied, or canceled according to the gamemode
}>

// Distributed actions which can be dispatched and then reduced
type PlayerActions = {
  UPDATE_HEALTH: { health: number } // the player's health needs a direct update
  TELEPORT_TO: State['position'] // the player needs to be teleported
  LOOT_ITEM: {
    type: string
    count: number
    position: { x: number; y: number; z: number }
  } // the player needs to receive a new item
  REGENERATE_SOUL: { amount: number } // the soul of player should regenerate a bit
  UPDATE_SOUL: { soul: number } // the player's soul needs a direct update, this is only used as an admin interraction through commands
  DIE: null // the player should die
  RESYNC_INVENTORY: null // the inventory of the player should be resynced
  SWITCH_GAMEMODE: { game_mode: number } // the gamemode of the player should be updated
  RECEIVE_EXPERIENCE: { experience: number } // the player should receive experience
  STORE_HEAD_TEXTURE: string[][] // save the player's head texture
  UPDATE_SETTINGS: { top_left_ui_offset: number } // some settings of the player should be updated
  SWITCH_SPELL: number // player switched hotbar slot
  CAST_SPELL: { selected_spell: number } // player casting a spell

  'packet/position': any
  'packet/position_look': any
  'packet/look': any
  'packet/settings': any
  'packet/window_click': any
}

// Local events which can be emited and then listened
type MobEvents = TypedEmitter<{
  STATE_UPDATED: MobState // a mob state has been updated
}>

// Distributed actions which can be dispatched and then reduced
type MobActions = {
  RECEIVE_DAMAGE: {
    damage: number
    damager: string
    damager_position: State['position']
    damager_strength: number
    critical_hit: boolean
  } // a mob is receiving damages
  GOTO: { position: State['position'] } // a mob is going toward a position
  END_PATH: any
  TARGET_POSITION: State['position']
  WAKE_UP: any
  FORGET_TARGET: null // sometimes the mobs need to forget about his current target, like when the player died
}

type PlayerAction = {
  [K in keyof PlayerActions]: { type: K; payload: PlayerActions[K] }
}[keyof PlayerActions]

type MobAction = {
  [K in keyof MobActions]: { type: K; payload: MobActions[K]; time: number }
}[keyof MobActions]
