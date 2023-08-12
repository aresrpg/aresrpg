import { createCanvas, loadImage } from 'canvas'

import { write_brand } from '../core/plugin_channels.js'
import { dimension_codec, overworld } from '../core/world.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import { write_title } from '../core/title.js'
import { Formats, world_chat_msg } from '../core/chat.js'
import { BLOCK_TAGS, ENTITY_TAGS, FLUID_TAGS, ITEM_TAGS } from '../core/tags.js'
import logger from '../logger.js'
import { set_world_border } from '../core/world_border.js'

const log = logger(import.meta)
const A_WEEK = 1000 * 60 * 60 * 24 * 7

/** returns a 8x8 pixels matrix from an uuid */
function fetch_head_pixels(client) {
  log.info({ player: client.username }, `fetch head's pixels`)
  // TODO: do not rely on third parties https://github.com/aresrpg/aresrpg/issues/682
  return fetch(`https://minotar.net/avatar/${client.uuid}/8`)
    .then(response => response.arrayBuffer())
    .then(array_buffer => Buffer.from(array_buffer))
    .then(buffer => loadImage(buffer))
    .then(img => {
      // create a canvas from the image data
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      // iterate over each pixel in the canvas and add its hex color to the matrix
      return Array.from({ length: canvas.height }, (_, y) =>
        Array.from({ length: canvas.width }, (_, x) => {
          const pixelData = ctx.getImageData(x, y, 1, 1).data
          return `#${((pixelData[0] << 16) | (pixelData[1] << 8) | pixelData[2])
            .toString(16)
            .padStart(6, '0')}`
        }),
      )
    })
}

/** @type {import('../server').Module} */
export default {
  name: 'player_login',
  reduce(state, { type, payload }) {
    if (type === 'STORE_HEAD_TEXTURE') {
      return {
        ...state,
        user_interface: {
          ...state.user_interface,
          head_texture: payload,
          // cache the texture for 7 days
          head_texture_expiration: Date.now() + A_WEEK,
        },
      }
    }
    return state
  },

  observe({ client, events, world, signal, dispatch }) {
    events.once('STATE_UPDATED', state => {
      const {
        game_mode,
        position,
        view_distance,
        last_disconnection_time,
        user_interface: { head_texture_expiration },
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

      set_world_border({ client, x: 510, z: 510, radius: 1020, speed: 1 })

      client.write('held_item_slot', { slot: 0 })

      write_title({
        client,
        subtitle: { text: 'Welcome on AresRPG' },
        times: {
          fadeIn: 2,
          fadeOut: 2,
          stay: 10,
        },
      })

      if (head_texture_expiration <= Date.now())
        fetch_head_pixels(client)
          .then(pixel_matrix => dispatch('STORE_HEAD_TEXTURE', pixel_matrix))
          .catch(error =>
            log.error(
              error,
              `unable to fetch ${client.username}'s head pixels`,
            ),
          )

      if (!last_disconnection_time)
        world_chat_msg({
          world,
          client,
          message: [
            { text: client.username, ...Formats.SUCCESS },
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
