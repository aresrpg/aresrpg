import { is_inside3d } from '../math.js'

export function is_inside_platform(platform, position) {
  const {
    size: { width, height },
    get_state,
  } = platform
  const { position: platform_pos } = get_state()

  return is_inside3d(
    {
      min: platform_pos,
      max: {
        x: platform_pos.x + width,
        y: platform_pos.y + 1.1,
        z: platform_pos.z + height,
      },
    },
    position
  )
}
