import { chunk_position } from '../chunk.js'
import { write_brand } from '../plugin_channels.js'
import { dimension_codec, overworld } from '../world/codec.js'
import { load_chunks } from '../chunk/update.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import { write_title } from '../title.js'
import { PlayerEvent } from '../events.js'
import { Formats, world_chat_msg } from '../chat.js'

import { set_world_border } from './world_border.js'
import { BLOCK_TAGS, ENTITY_TAGS, FLUID_TAGS, ITEM_TAGS } from './tags.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, signal, dispatch }) {
    events.once(PlayerEvent.STATE_UPDATED, state => {
      const {
        nickname,
        game_mode,
        position,
        view_distance,
        held_slot_index,
        last_disconnection_time,
      } = state
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

      client.write('spawn_position', { location: world.spawn_position })

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

      if (!last_disconnection_time)
        world_chat_msg({
          world,
          client,
          message: [
            { text: nickname, ...Formats.SUCCESS },
            { text: ' just joined ', ...Formats.BASE },
            { text: 'AresRPG', ...Formats.INFO },
            { text: ' for the first time', ...Formats.BASE },
          ],
        })

      client.write('tags', {
        blockTags: BLOCK_TAGS,
        itemTags: ITEM_TAGS,
        fluidTags: FLUID_TAGS,
        entityTags: ENTITY_TAGS,
      })
    })
  },
}
