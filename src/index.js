import protocol from 'minecraft-protocol'
import { version, online_mode } from './settings.js'
import login from './login.js'
import { floor1 as world } from './world.js'
import update_chunks from './chunk/update.js'
import EventEmitter from 'events'
import { position_change_event } from './events.js'
import { chunk_change_event, chunk_position } from './chunk.js'
import { open_trade } from './trade/trade.js'
import { spawn_villager } from './trade/spawn_villager.js'

const server = protocol.createServer({ version, 'online-mode': online_mode })

server.on('login', (client) => {
  const state = {
    client,
    world,
    position: world.spawn_position,
    chunk: {
      x: chunk_position(world.spawn_position.x),
      z: chunk_position(world.spawn_position.z),
    },
    events: new EventEmitter(),
    gameMode: 1,
  }

  login(state)
  position_change_event(state)
  chunk_change_event(state)
  update_chunks(state)
  spawn_villager(state)
  open_trade(state)
})

server.on('listening', () => {
  console.log('Listening on', server.socketServer.address())
})

process.on('unhandledRejection', (error) => {
  throw error
})
