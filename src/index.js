import protocol from 'minecraft-protocol'
import { on, EventEmitter } from 'events'
import { reduce, map, parallelMerge, pipeline } from 'streaming-iterables'
import { PassThrough } from 'stream'

import { scan } from './iterables.js'
import { version, online_mode } from './settings.js'
import login from './login.js'
import { floor1 } from './world.js'
import update_chunks from './chunk/update.js'
import { reduce_position } from './position.js'
import { register_trades, open_trade } from './trade/trade.js'
import { register_traders, spawn_merchants } from './trade/spawn_villagers.js'
import { register_mobs, spawn_mob } from './mobs/spawn_mob.js'
import { send_resource_pack } from './resource_pack.js'
import { update_experience } from './experience.js'
import {
  reduce_plugin_channels,
  transform_plugin_channels,
} from './plugin_channels.js'
import chat from './chat.js'
import { reduce_view_distance } from './view_distance.js'
import logger from './logger.js'

const log = logger(import.meta)

const server = protocol.createServer({ version, 'online-mode': online_mode })

const initial_world = [
  // Reducers that augment the world with extra properties
  register_mobs,
  register_traders,
  register_trades,
].reduce((world, fn) => fn(world), {
  ...floor1,
  next_entity_id: 0,
  next_window_id: 1, // 0 is the player inventory
})

const initial_state = ({ entity_id, world }) => ({
  entity_id,
  world,
  position: world.spawn_position,
  view_distance: 0,
  inventory: Array.from({
    length: 46,
    36: { type: 'spellbook', count: 1 },
    37: { type: 'bronze_coin', count: 10 },
    38: { type: 'menitrass_100', count: 1 },
  }),
  game_mode: 2,
  experience: 0,
})

function reduce_state(state, action) {
  return [
    /* Reducers that map the incomming actions (packet, ...)
     * to a new state */
    reduce_position,
    reduce_view_distance,
    reduce_plugin_channels,
  ].reduce((intermediate, fn) => fn(intermediate, action), state)
}

function transform_action(action) {
  return [
    /* Map functions that are applied to all actions */
    transform_plugin_channels,
  ].reduce((intermediate, fn) => fn(intermediate), action)
}

function observe_client(context) {
  /* Observers that handle the protocol part.
   * They get the client and should map it to minecraft protocol */
  login(context)
  update_chunks(context)
  send_resource_pack(context)
  spawn_mob(context)
  spawn_merchants(context)
  open_trade(context)
  update_experience(context)
  chat({ server, ...context }) // TODO: remove server
}

/* The following code handle the pipeline, it works as following
 *
 * state = initial_state
 * on packets + on actions
 *   |> transform_action
 *   |> (state = reduce_state(state))
 *   |> observe_client
 *
 * the pipeline function is just an helper to do:
 * c(b(a())) == pipeline(a, b, c) */

pipeline(
  () => on(server, 'login'),
  reduce(
    ({ world: last_world }, [client]) => {
      client.on('error', (error) => {
        throw error
      })

      const actions = new PassThrough({ objectMode: true })

      const packets = pipeline(
        () => on(client, 'packet'),
        map(([payload, { name }]) => ({
          type: `packet/${name}`,
          payload,
        }))
      )

      const world = {
        ...last_world,
        next_entity_id: last_world.next_entity_id + 1,
      }

      const events = new EventEmitter()

      pipeline(
        () => parallelMerge(actions, packets),
        map(transform_action),
        scan(
          reduce_state,
          initial_state({ entity_id: last_world.next_entity_id, world })
        ),
        async (states) => {
          for await (const state of states) events.emit('state', state)
        }
      )

      observe_client({
        client,
        world,
        events,
        dispatch(type, payload) {
          actions.write({ type, payload })
        },
      })

      return {
        world,
      }
    },
    { world: initial_world }
  )
)

server.once('listening', () => {
  log.info(server.socketServer.address(), 'Listening')
})

process.on('unhandledRejection', (error) => {
  throw error
})
