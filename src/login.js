import canvas from 'canvas'

import { chunk_position } from './chunk.js'
import { empty_slot, item_to_slot } from './items.js'
import { write_brand } from './plugin_channels.js'
import { dimension_codec, overworld } from './world/codec.js'
import { load_chunks } from './chunk/update.js'
import { write_title } from './title.js'
import {
  copy_canvas,
  get_screen,
  spawn_screen,
  update_screen,
} from './screen.js'

const { createCanvas } = canvas

export default function login({ client, events }) {
  events.once('state', async (state) => {
    const {
      world,
      game_mode,
      position,
      entity_id,
      inventory,
      view_distance,
    } = state
    // TODO: move this elsewhere
    const world_names = ['minecraft:overworld']
    // TODO: we should not take the first world of the list
    const [world_name] = world_names

    client.write('login', {
      entityId: entity_id,
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
      enableRespawnScreen: true,
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

    load_chunks(state, { client, events, chunks: [chunk] })

    const to_slot = (item) =>
      item ? item_to_slot(world.items[item.type], item.count) : empty_slot

    client.write('window_items', {
      windowId: 0,
      items: inventory.map(to_slot),
    })

    write_title(client, {
      subtitle: { text: 'Bienvenue sur' },
      title: { text: 'AresRPG' },
      fadeIn: 5,
      fadeOut: 2,
      stay: 1,
    })

    const screen_pos = { ...world.spawn_position, y: world.spawn_position.y + 15 }

    spawn_screen(
      { client, world },
      {
        screen_id: 'player_screen',
        position: screen_pos,
        direction: { x: 1, y: 0, z: 0 },
      }
    )

    let last_frame = null
    const { size } = get_screen(world, 'player_screen')
    const canvas = createCanvas(size.width * 128, size.height * 128)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, size.width * 128, size.height * 128)
    events.on(
      'screen_interract',
      ({ x, y, screen_id, hand }) => {
        ctx.font = '30px arial'
        ctx.fillStyle = 'red'
        ctx.beginPath()
        ctx.ellipse(x, y, 10, 10, 0, 0, Math.PI * 2)
        ctx.fill()
        update_screen(
          { client, world },
          { screen_id, newCanvas: canvas, oldCanvas: last_frame }
        )
        last_frame = copy_canvas(canvas)
      },
      100
    )
  })
}
