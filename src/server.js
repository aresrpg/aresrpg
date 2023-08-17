import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { EventEmitter } from 'events'

import protocol from 'minecraft-protocol'

import package_json from '../package.json' assert { type: 'json' }

import * as settings from './settings.js'
import logger from './logger.js'
import motd_component from './core/motd.js'
import start_debug_server from './core/behavior_debug.js'
import { USE_RESOURCE_PACK } from './settings.js'
import { create_world } from './world.js'
import { create_mob_handler } from './mobs.js'
import register_mobs_position from './world/register_mobs_position.js'
import register_villager_traders from './world/register_villager_traders.js'
import register_damage_indicator from './world/register_damage_indicator.js'
import register_experience_firework from './world/register_experience_firework.js'
import register_teleportation_stones from './world/register_teleportation_stones.js'
import entity_attack from './modules/entity_attack.js'
import entity_damage from './modules/entity_damage.js'
import entity_dialog from './modules/entity_dialog.js'
import entity_goto from './modules/entity_goto.js'
import entity_look_at from './modules/entity_look_at.js'
import entity_loot from './modules/entity_loot.js'
import entity_movements from './modules/entity_movements.js'
import entity_path from './modules/entity_path.js'
import entity_sound from './modules/entity_sound.js'
import entity_spawn from './modules/entity_spawn.js'
import entity_target from './modules/entity_target.js'
import entity_wakeup from './modules/entity_wakeup.js'
import entity_behavior from './modules/entity_behavior.js'
import player_attributes from './modules/player_attributes.js'
import player_block_placement from './modules/player_block_placement.js'
import player_inventory from './modules/player_inventory.js'
import player_position from './modules/player_position.js'
import player_chunk from './modules/player_chunk.js'
import player_bells from './modules/player_bells.js'
import player_chat from './modules/player_chat.js'
import player_damage from './modules/player_damage.js'
import player_environmental_damage from './modules/player_environmental_damage.js'
import player_experience from './modules/player_experience.js'
import player_fall_damage from './modules/player_fall_damage.js'
import player_health from './modules/player_health.js'
import player_heartbeat from './modules/player_heartbeat.js'
import player_respawn from './modules/player_respawn.js'
import player_soul from './modules/player_soul.js'
import player_spell from './modules/player_spell.js'
import player_sync from './modules/player_sync.js'
import player_tablist from './modules/player_tablist.js'
import player_teleportation_stones from './modules/player_teleportation_stones.js'
import entity_trader from './modules/entity_trader.js'
import player_ui from './modules/player_ui.js'
import player_commands from './modules/player_commands.js'
import player_finalization from './modules/player_finalization.js'
import player_resource_pack from './modules/player_resource_pack.js'
import player_login from './modules/player_login.js'
import player_statistics from './modules/player_statistics.js'
import { create_client_handler } from './player.js'
import player_main_menu from './modules/player_main_menu.js'

/** @template U
 * @typedef {import('./types').UnionToIntersection<U>} UnionToIntersection */

/** @typedef {import("./player").Reducer} Reducer */
/** @typedef {import("./player").Observer} Observer */
/** @typedef {import("./mobs").MobsReducer} MobsReducer */
/** @typedef {import("./mobs").MobObserver} MobObserver */
/** @typedef {{name: string, reduce?: Reducer, observe?: Observer, reduce_mob?: MobsReducer, observe_mob?: MobObserver }} Module */

/** @typedef {typeof initial_world_reducers} WorldReducers */
/** @typedef {Readonly<UnionToIntersection<ReturnType<typeof initial_world_reducers[number]>>>} World */

const log = logger(import.meta)

const MAX_PLAYERS = -1
const { VERSION, ONLINE_MODE, DEBUG_SERVER } = settings
const favicon = `data:image/png;base64,${fs.readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../media/favicon.png'),
  'base64',
)}`

const initial_world_reducers = [
  register_mobs_position,
  register_villager_traders,
  register_damage_indicator,
  register_experience_firework,
  register_teleportation_stones,
]

const entity_modules = [
  entity_attack,
  entity_damage,
  entity_dialog,
  entity_goto,
  entity_look_at,
  entity_loot,
  entity_movements,
  entity_path,
  entity_sound,
  entity_spawn,
  entity_target,
  entity_wakeup,
  entity_behavior,
  entity_trader,
]

const world = await Promise.resolve(entity_modules)
  .then(create_mob_handler)
  .then(create_world(initial_world_reducers))

const observables = {
  /** @type {import("./player").Observables} */
  optional_modules: {
    'MAIN:MENU': [player_main_menu],
    'GAME:GHOST': [
      player_attributes,
      player_bells,
      player_block_placement,
      player_position,
      player_soul,
      player_sync,
      player_tablist,
      player_ui,
      player_chunk,
    ],
    'GAME:ALIVE': [
      player_attributes,
      player_bells,
      player_block_placement,
      player_position,
      player_damage,
      player_environmental_damage,
      player_experience,
      player_fall_damage,
      player_health,
      player_heartbeat,
      player_inventory,
      player_respawn,
      player_soul,
      player_spell,
      player_sync,
      player_tablist,
      player_teleportation_stones,
      player_ui,
      player_chunk,

      // a quick note on those, each module may contains
      // reduce(), reduce_mob(), observe(), observe_mob()
      // we don't need to unload any mob related logic, only the player related logic
      // so while we feed everything, each part will extract what it needs
      // therefore when switching game state, only the observe() will be using proxies
      ...entity_modules,
    ],
  },
  // Those modules will be loaded once and never unloaded
  mandatory_modules: [
    player_finalization,
    ...(USE_RESOURCE_PACK ? [player_resource_pack] : []),
    player_login,
    player_statistics,
    player_commands,
    player_chat,
  ],
  world,
}

export const debug_behavior_emitter = new EventEmitter()

export default function create_server() {
  log.info(settings, `Starting AresRPG ${package_json.version}`)

  const client_listener = create_client_handler(observables)
  const server = protocol.createServer({
    version: VERSION,
    'online-mode': ONLINE_MODE,
    motd: 'loading...',
    maxPlayers: MAX_PLAYERS,
    favicon,
    errorHandler: (client, error) => {
      switch (error.message) {
        case 'read ECONNRESET':
        case 'This socket has been ended by the other party':
          break
        default:
          log.error(error, 'Client error')
          break
      }
      client.end(error.message)
    },
    beforePing: (response, client) => {
      return {
        ...response,
        players: {
          max: MAX_PLAYERS,
          online: response.players.online,
          sample: [
            {
              name: 'Built on Sui',
              id: '00000000-0bad-cafe-babe-000000000000',
            },
          ],
        },
        description: motd_component,
        favicon,
      }
    },
  })

  if (DEBUG_SERVER) {
    const { behavior, app } = start_debug_server(world)

    debug_behavior_emitter.on('run', behavior)

    // @ts-expect-error No overload matches this call.
    server.once('close', () => {
      debug_behavior_emitter.off('run', behavior)
      app.close()
    })
  }

  server.on('login', client => client_listener({ client, server }))
  server.once('listening', () => {
    log.info(server.socketServer.address(), 'Listening')
  })

  return server
}
