import protocol from 'minecraft-protocol'
import { version, online_mode } from './settings.js'
import login from './login.js'
import { floor1 as world } from './world.js'
import update_chunks from './chunk/update.js'
import EventEmitter from 'events'
import { position_change_event } from './events.js'
import { chunk_change_event, chunk_position } from './chunk.js'
import { worldMobsSpawn } from './worldMobs/worldMobsSpawn.js'
import { openTrade } from './trade/trade.js'

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
  client.on('end', console.error)
  login(state)
  position_change_event(state)
  chunk_change_event(state)
  update_chunks(state)
  worldMobsSpawn(state)
  openTrade(state)
  client.on('error', console.log)
  client.on('end', console.log)
})

server.on('listening', () => {
  console.log('Listening on', server.socketServer.address())
})

process.on('unhandledRejection', (error) => {
  throw error
})