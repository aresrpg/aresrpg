import protocol from 'minecraft-protocol'
import EventEmitter from 'events'

import { version, online_mode } from './settings.js'
import login from './login.js'
import { floor1 } from './world.js'
import update_chunks from './chunk/update.js'
import { position_change_event } from './events.js'
import { chunk_change_event, chunk_position } from './chunk.js'
import { register_villagers, spawn_villager } from './trade/spawn_villager.js'
import { register_trades, open_trade } from './trade/trade.js'
import { register_mobs, spawn_mob } from './mobs/spawn_mob.js'
import { send_resource_pack } from './resource_pack.js'
import { update_experience } from './experience.js'
import { register_plugin_channels } from './plugin_channels.js'
import logger from './logger.js'

const log = logger(import.meta)

const server = protocol.createServer({ version, 'online-mode': online_mode })

const world = [
  // prettier-ignore
  register_villagers,
  register_trades,
  register_mobs,
].reduce((world, fn) => fn(world), {
  ...floor1,
  events: new EventEmitter(),
  lastEntityId: 0,
  lastWindowId: 1, // 0 is the player inventory
})

handle_login(world)

function handle_login(world) {
  server.once('login', (client) => {
    const state = {
      entityId: world.lastEntityId,
      client,
      world,
      position: world.spawn_position,
      chunk: {
        x: chunk_position(world.spawn_position.x),
        z: chunk_position(world.spawn_position.z),
      },
      inventory: Array.from({
        length: 46,
        36: { type: 'spellbook', count: 1 },
        37: { type: 'bronze_coin', count: 10 },
        38: { type: 'menitrass_100', count: 1 },
      }),
      events: new EventEmitter(),
      gameMode: 2,
      experience: 0,
    }

    // Handle next login
    handle_login({ ...world, lastEntityId: world.lastEntityId + 1 })

    register_plugin_channels(state)
    login(state)
    update_experience(state)
    send_resource_pack(state)
    position_change_event(state)
    chunk_change_event(state)
    update_chunks(state)
    spawn_villager(state)
    open_trade(state)
    spawn_mob(state)
  })
}

server.on('listening', () => {
  log.info(server.socketServer.address(), 'Listening')
})

process.on('unhandledRejection', (error) => {
  throw error
})
