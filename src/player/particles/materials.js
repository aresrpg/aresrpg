import { hsl_to_rgb } from '../../color.js'

import { ParticlesTypes } from './particles.js'

export function rainbow_rainbow_material({ progress }) {
  return {
    colorize_vertice(geometry, vertice, index) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles

      const side_index = Math.min(
        1,
        index / geometry.sides / geometry.max_circles
      )
      return {
        particle_id: ParticlesTypes.RGB,
        data: {
          ...hsl_to_rgb(1 - h, 0.9, 0.5),
          scale: 2,
        },
        visible: side_index > progress - 0.1 && side_index < progress + 0.1,
      }
    },
  }
}

export function rainbow_torus_material() {
  return {
    colorize_vertice(geometry, vertice, index) {
      const circle_index = Math.floor(index / geometry.radial_segments)
      const h = Math.min(1, circle_index / geometry.tubular_segments)

      return {
        particle_id: ParticlesTypes.RGB,
        data: {
          ...hsl_to_rgb(h, 0.9, 0.5),
          scale: 1,
        },
        visible: true,
      }
    },
  }
}
