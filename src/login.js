import { dimension_codec } from './world/codec.js'
import { item_to_slot, empty_slot } from './items.js'
import { write_brand } from './plugin_channels.js'
import { chunk_position } from './chunk.js'

export default function login({ client, events }) {
  events.once(
    'state',
    ({ world, game_mode, position, entity_id, inventory }) => {
      // TODO: move this elsewhere
      const world_names = ['minecraft:overworld']
      // TODO: we should not take the first world of the list
      const [world_name] = world_names

      client.write('login', {
        entityId: entity_id,
        gameMode: game_mode,
        previousGameMode: 255,
        worldNames: world_names,
        dimensionCodec: dimension_codec,
        dimension: 'minecraft:overworld',
        worldName: world_name,
        hashedSeed: [0, 0],
        maxPlayers: 32,
        viewDistance: 12,
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

      client.write('update_view_position', {
        chunkX: chunk_position(position.x),
        chunkZ: chunk_position(position.z),
      })

      const to_slot = (item) =>
        item ? item_to_slot(world.items[item.type], item.count) : empty_slot

      client.write('window_items', {
        windowId: 0,
        items: inventory.map(to_slot),
      })
    }
  )
}
