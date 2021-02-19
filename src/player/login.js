import { chunk_position } from '../chunk.js'
import { empty_slot, item_to_slot } from '../items.js'
import { write_brand } from '../plugin_channels.js'
import { dimension_codec, overworld } from '../world/codec.js'
import { load_chunks } from '../chunk/update.js'
import { PLAYER_ENTITY_ID, PLAYER_INVENTORY_ID } from '../index.js'

import { write_title } from './title.js'
import { set_world_border } from './world_border.js'

export default function login({ client, events, world }) {
  events.once('state', (state) => {
    const { game_mode, position, inventory, view_distance } = state
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

    set_world_border({ client, x: 510, z: 510, radius: 1020, speed: 1 })

    load_chunks(state, { client, world, events, chunks: [chunk] })

    const to_slot = (item) =>
      item ? item_to_slot(world.items[item.type], item.count) : empty_slot

    client.write('window_items', {
      windowId: PLAYER_INVENTORY_ID,
      items: inventory.map(to_slot),
    })

    write_title(client, {
      subtitle: { text: 'Bienvenue sur' },
      title: { text: 'AresRPG' },
      fadeIn: 5,
      fadeOut: 2,
      stay: 10,
    })
  })
}
