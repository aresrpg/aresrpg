import { dimensionCodec } from './world/codec.js'

export default function login({ client, world, gameMode, position, chunk }) {
  // TODO: move this elsewhere
  const worldNames = ['minecraft:overworld']
  // TODO: we should not take the first world of the list
  const [worldName] = worldNames
  const { entityId } = client

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
}
