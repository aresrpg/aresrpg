import { EventEmitter, on } from 'events'
import { PassThrough } from 'stream'
import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import protocol from 'minecraft-protocol'
import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import chat from './chat.js'
import update_chunks from './chunk/update.js'
import { update_experience } from './experience.js'
import logger from './logger.js'
import login from './login.js'
import { register_mobs } from './mobs.js'
import { send_resource_pack } from './resource_pack.js'
import {
  reduce_plugin_channels,
  transform_plugin_channels,
} from './plugin_channels.js'
import { reduce_position } from './position.js'
import player_fall_damage from './player/fall_damage.js'
import player_health from './player/health.js'
import player_attributes from './player/attributes.js'
import { online_mode, version } from './settings.js'
import { register_traders, spawn_merchants } from './trade/spawn_villagers.js'
import { open_trade, register_trades } from './trade/trade.js'
import dialog from './mobs/dialog.js'
import { deal_damage } from './mobs/fight.js'
import { reduce_view_distance } from './view_distance.js'
import { statistics } from './statistics.js'
import { floor1 } from './world.js'
import { update_clients } from './mobs/position.js'
import { mob_goto } from './mobs/goto.js'
import { last_event_value } from './events.js'
import declare_commands from './commands/declare_commands.js'

const log = logger(import.meta)

const server = protocol.createServer({
  version,
  'online-mode': online_mode,
  motd: 'AresRPG',
  favicon: `data:image/png;base64,${fs.readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../media/favicon.png'),
    'base64'
  )}`,
})

const initial_world = [
  // Reducers that augment the world with extra properties
  register_mobs,
  register_traders,
  register_trades,
].reduce((world, fn) => fn(world), {
  ...floor1,
  events: new EventEmitter(),
  next_entity_id: 0,
  next_window_id: 1, // 0 is the player inventory
  get: () => initial_world,
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
  health: 40,
})

function reduce_state(state, action) {
  return [
    /* Reducers that map the incomming actions (packet, ...)
     * to a new state */
    reduce_position,
    reduce_view_distance,
    reduce_plugin_channels,
    player_fall_damage.reducer,
  ].reduce((intermediate, fn) => fn(intermediate, action), state)
}

function transform_action(action) {
  return [
    /* Map functions that are applied to all actions */
    transform_plugin_channels,
  ].reduce((intermediate, fn) => fn(intermediate), action)
}

const update_mobs_position = update_clients(initial_world)

async function observe_client(context) {
  /* Observers that handle the protocol part.
   * They get the client and should map it to minecraft protocol */

  await send_resource_pack(context)
  login(context)
  update_chunks(context)
  update_mobs_position(context)
  mob_goto(context)
  spawn_merchants(context)
  open_trade(context)
  dialog(context)
  deal_damage(context)
  statistics(context)
  update_experience(context)
  declare_commands(context)
  player_fall_damage.observer(context)
  player_health.observer(context)
  player_attributes.observer(context)
  chat({ server, ...context }) // TODO: remove server
}

/* The following code handle the pipeline, it works as following
 *
 * state = initial_state
 * on packets + on actions
 *   |> transform_action
 *   |> (state = reduce_state(state))
 *   |> observe_client
 */

aiter(on(server, 'login')).reduce(
  ({ world: last_world }, [client]) => {
    client.on('error', (error) => {
      throw error
    })

    const actions = new PassThrough({ objectMode: true })

    const packets = aiter(on(client, 'packet')).map(([payload, { name }]) => ({
      type: `packet/${name}`,
      payload,
    }))

    const world = {
      ...last_world,
      next_entity_id: last_world.next_entity_id + 1,
    }

    const events = new EventEmitter()

    aiter(combineAsyncIterators(actions[Symbol.asyncIterator](), packets))
      .map(transform_action)
      .reduce((last_state, action) => {
        const state = reduce_state(last_state, action)
        events.emit('state', state)
        return state
      }, initial_state({ entity_id: last_world.next_entity_id, world }))

    observe_client({
      client,
      world,
      events,
      get_state: last_event_value(events, 'state'),
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

server.once('listening', () => {
  log.info(server.socketServer.address(), 'Listening')
})

process.on('unhandledRejection', (error) => {
  throw error
})
