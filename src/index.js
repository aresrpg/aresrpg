import protocol from 'minecraft-protocol'
import { version, online_mode } from './settings.js'
import login from './login.js'
import { floor1 } from './world.js'
import update_chunks from './chunk/update.js'
import EventEmitter from 'events'
import { position_change_event } from './events.js'
import { chunk_change_event, chunk_position } from './chunk.js'
import { open_trade } from './trade/trade.js'
import { spawn_villager } from './trade/spawn_villager.js'
import { spawn_mob } from './mobs/spawn_mob.js'
import { send_resource_pack } from './resource_pack.js'

const server = protocol.createServer({ version, 'online-mode': online_mode })

const world = {
  ...floor1,
  events: new EventEmitter(),
  lastEntityId: 0,
  lastWindowId: 1, // 0 is the player inventory
}

handle_login(
  [
    // prettier-ignore
    spawn_villager,
    open_trade,
    spawn_mob,
  ].reduce(
    ({ world, handlers }, fn) => {
      const { world: fn_world, handlers: fn_handlers } = fn(world)

      return {
        world: fn_world,
        handlers: [...handlers, ...fn_handlers],
      }
    },
    { world, handlers: [] }
  )
)

function handle_login({ world, handlers }) {
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
    }

    // Handle next login
    handle_login({
      world: { ...world, lastEntityId: world.lastEntityId + 1 },
      handlers,
    })

    login(state)
    send_resource_pack(state)
    position_change_event(state)
    chunk_change_event(state)
    update_chunks(state)
    for (const handler of handlers) handler(state)
  })
}

server.on('listening', () => {
  console.log('Listening on', server.socketServer.address())
})

process.on('unhandledRejection', (error) => {
  throw error
})
