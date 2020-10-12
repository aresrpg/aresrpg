import { dimensionCodec } from './world/codec.js'
import { item_to_slot, empty_slot } from './items.js'

export default function login({
  client,
  world,
  gameMode,
  position,
  chunk,
  entityId,
  inventory,
}) {
  // TODO: move this elsewhere
  const worldNames = ['minecraft:overworld']
  // TODO: we should not take the first world of the list
  const [worldName] = worldNames

  client.write('login', {
    entityId,
    gameMode,
    previousGameMode: 255,
    worldNames,
    dimensionCodec,
    dimension: 'minecraft:overworld',
    worldName,
    hashedSeed: [0, 0],
    maxPlayers: 32,
    viewDistance: 12,
    reducedDebugInfo: false,
    enableRespawnScreen: true,
    isDebug: false,
    isFlat: false,
  })

  client.write('position', {
    ...position,
    flags: 0x00,
    teleportId: 0,
  })

  client.write('update_view_position', {
    chunkX: chunk.x,
    chunkZ: chunk.z,
  })

  const to_slot = (item) =>
    item ? item_to_slot(world.items[item.type], item.count) : empty_slot

  client.write('window_items', {
    windowId: 0,
    items: inventory.map(to_slot),
  })
}
