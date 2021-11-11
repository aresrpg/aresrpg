import { on } from 'events'

import { aiter } from 'iterator-helper'

import { chunk_position } from '../chunk.js'
import { write_brand } from '../plugin_channels.js'
import { dimension_codec, overworld } from '../world/codec.js'
import { load_chunks } from '../chunk/update.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import { abortable } from '../iterator.js'
import { write_title } from '../title.js'
import { Context, Action } from '../events.js'

import { set_world_border } from './world_border.js'
import {
  copy_canvas,
  create_screen_canvas,
  spawn_screen,
  update_screen,
} from './screen.js'

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.LOGIN) {
      const { time } = payload
      return {
        ...state,
        last_connection_time: time,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, signal, dispatch }) {
    events.once(Context.STATE, state => {
      const { game_mode, position, view_distance, held_slot_index } = state
      // TODO: move this elsewhere
      const world_names = ['minecraft:overworld']
      // TODO: we should not take the first world of the list
      const [world_name] = world_names

      client.write('login', {
        entityId: PLAYER_ENTITY_ID,
        isHardcore: false,
        gameMode: game_mode,
        previousGameMode: 255,
        worldNames: world_names,
        dimensionCodec: dimension_codec,
        dimension: overworld,
        worldName: world_name,
        hashedSeed: [0, 0],
        maxPlayers: 32,
        viewDistance: view_distance,
        reducedDebugInfo: false,
        enableRespawnScreen: false,
        isDebug: false,
        isFlat: false,
      })

      write_brand(client, { brand: 'AresRPG' })

      client.write('position', {
        ...position,
        flags: 0x00,
        teleportId: 0,
      })

      const chunk = {
        x: chunk_position(position.x),
        z: chunk_position(position.z),
      }

      client.write('update_view_position', {
        chunkX: chunk.x,
        chunkZ: chunk.z,
      })

      set_world_border({ client, x: 510, z: 510, radius: 1020, speed: 1 })

      load_chunks(state, { client, world, events, chunks: [chunk] })

      client.write('held_item_slot', { slot: held_slot_index })

      write_title({
        client,
        subtitle: { text: 'Welcome on AresRPG' },
        times: {
          fadeIn: 2,
          fadeOut: 2,
          stay: 10,
        },
      })

      const screen_pos = {
        ...world.spawn_position,
        y: world.spawn_position.y + 15,
      }

      spawn_screen(
        { client, world },
        {
          screen_id: 'player_screen',
          position: screen_pos,
          direction: { x: 1, y: 0, z: 0 },
        }
      )

      const { canvas } = create_screen_canvas(world.screens.player_screen)

      aiter(abortable(on(events, Context.SCREEN_INTERRACT, { signal }))).reduce(
        (old_canvas, [{ x, y, screen_id, hand }]) => {
          const new_canvas = copy_canvas(old_canvas)

          const ctx = new_canvas.getContext('2d')
          ctx.font = '30px arial'
          ctx.fillStyle = 'red'
          ctx.beginPath()
          ctx.ellipse(x, y, 10, 10, 0, 0, Math.PI * 2)
          ctx.fill()

          update_screen(
            { client, world },
            { screen_id, new_canvas, old_canvas }
          )

          return new_canvas
        },
        canvas
      )

      // make sure all pods are running with UTC time
      dispatch(Action.LOGIN, { time: Date.now() })
    })
  },
}
