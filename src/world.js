import Anvil from 'prismarine-provider-anvil'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { version } from './settings.js'

const AnvilWorld = Anvil.Anvil(version)

export const floor1 = {
  spawn_position: { x: 469.5, y: 162, z: 646.5, yaw: 25, pitch: 0 },
  chunks: new AnvilWorld(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'world',
      'floor1',
      'region'
    )
  ),
}
