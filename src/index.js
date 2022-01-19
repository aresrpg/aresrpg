import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import pino from 'pino'
import protocol from 'minecraft-protocol'

import motd_component from './motd.js'
import { ONLINE_MODE, VERSION } from './settings.js'
import logger from './logger.js'

const log = logger(import.meta)
const MAX_PLAYERS = -1
const favicon = `data:image/png;base64,${fs.readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../media/favicon.png'),
  'base64'
)}`

const server = protocol.createServer({
  version: VERSION,
  'online-mode': ONLINE_MODE,
  motd: 'loading...',
  maxPlayers: MAX_PLAYERS,
  favicon,
  beforePing: (response, client) => {
    return {
      ...response,
      players: {
        max: MAX_PLAYERS,
        online: response.players.online,
        sample: [
          {
            name: 'Built on Solana',
            id: '00000000-0bad-cafe-babe-000000000000',
          },
        ],
      },
      description: motd_component,
      favicon,
    }
  },
})

const context = import('./context.js')

server.on('login', client => {
  context
    .then(({ create_context, observe_client }) =>
      create_context(client).then(observe_client)
    )
    .catch(error => {
      log.error(
        {
          username: client.username,
          uuid: client.uuid,
          error: pino.stdSerializers.err(error),
        },
        'Create context error'
      )
      client.end(
        'There was a problem while initializing your character, please retry or contact us'
      )
    })
})

server.once('listening', () => {
  log.info(server.socketServer.address(), 'Listening')
})

process.on('unhandledRejection', error => {
  throw error
})
