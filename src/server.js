import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import EventEmitter from 'events'

import protocol from 'minecraft-protocol'
import pino from 'pino'

import package_json from '../package.json' assert { type: 'json' }

import * as settings from './settings.js'
import logger from './logger.js'
import {
  observe_client,
  create_context,
  world as original_world,
} from './context.js'
import motd_component from './motd.js'
import mobs_position_factory from './mobs/position.js'
import debug_server from './debug.js'

const log = logger(import.meta)
const { VERSION, ONLINE_MODE } = settings
const MAX_PLAYERS = -1
const favicon = `data:image/png;base64,${fs.readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../media/favicon.png'),
  'base64',
)}`

export function create_server() {
  log.info(settings, `Starting AresRPG ${package_json.version}`)

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

  /** @type {import('./context').World & { events: EventEmitter }} */
  const world = { ...original_world, events: new EventEmitter() }
  const mobs_position = mobs_position_factory(world)

  server.on('login', client => {
    const {
      mcversion: { minecraftVersion, version },
    } = server

    // check protocol versions
    if (client.protocolVersion !== version) {
      client.end(
        'Wrong minecraft version',
        JSON.stringify([
          { text: 'Currently only the version ', color: 'yellow' },
          { text: minecraftVersion, color: 'red' },
          { text: ' is supported.', color: 'yellow' },
          { text: '\n\n' },
          {
            text: 'Try restarting your game with this version.',
            color: 'gray',
          },
        ]),
      )
      log.info(
        {
          username: client.username,
          uuid: client.uuid,
        },
        'Client refused: wrong minecraft version',
      )
      return
    }

    create_context({ client, world })
      .then(observe_client({ mobs_position }))
      .catch(error => {
        log.error(
          {
            username: client.username,
            uuid: client.uuid,
            error: pino.stdSerializers.err(error),
          },
          'Create context error',
        )
        client.end(
          'There was a problem while initializing your character, please retry or contact us',
        )
      })
  })

  server.once('listening', () => {
    log.info(server.socketServer.address(), 'Listening')
  })

  // @ts-expect-error No overload matches this call.
  server.once('close', () => {
    if (debug_server.app) debug_server.app.close()
  })

  return server
}
