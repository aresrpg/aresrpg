import Anvil from 'prismarine-provider-anvil'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { version } from './settings.js'

const AnvilWorld = Anvil.Anvil(version)

export const floor1 = {
  spawn_position: { x: 75, y: 98, z: 75, yaw: 0, pitch: 0 },
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
