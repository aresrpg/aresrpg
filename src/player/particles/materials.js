import { hsl_to_rgb } from '../../color.js'

import { ParticlesTypes } from './particles.js'

export function rainbow_rainbow_material({ progress }) {
  return {
    colorize_vertice({ geometry, index }) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles
      const side_index = Math.min(
        1,
        index / geometry.segments / geometry.max_circles
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

export function rainbow_material({ progress }) {
  return {
    colorize_vertice() {
      return {
        particle_id: ParticlesTypes.RGB,
        data: {
          ...hsl_to_rgb(1 - progress, 0.9, 0.5),
          scale: 2,
        },
        visible: true,
      }
    },
  }
}

export function slash_material({
  progress,
  color = { red: 1, green: 1, blue: 1, scale: 1 }, // Only used when particle_id is PartycleType.RGB
  particle_id = ParticlesTypes.RGB
}) {
  return {
    colorize_vertice({ geometry, index }) {
      const side_index = Math.min(1, index / geometry.vertices.length)
      return {
        particle_id,
        data: {
          ...color,
        },
        visible: side_index > progress - 0.1 && side_index < progress + 0.1,
      }
    },
  }
}

export function fire_slash_material({ progress }) {
  return {
    colorize_vertice({ geometry, index }) {
      const side_index = Math.min(1, index / geometry.vertices.length)
      return {
        particle_id: ParticlesTypes.FIRE,
        data: {
          scale: 2,
        },
        visible: side_index > progress - 0.1 && side_index < progress + 0.1,
      }
    },
  }
}

export function permanent_fire_slash_material({ progress, max_progress = 1 }) {
  return {
    colorize_vertice({ geometry, index }) {
      const side_index = Math.min(1, index / geometry.vertices.length)
      return {
        particle_id: ParticlesTypes.FIRE,
        data: {
          scale: 2,
        },
        visible: side_index > progress - 0.1 && progress <= max_progress,
      }
    },
  }
}

export function lava_column_material({ progress }) {
  return {
    colorize_vertice({ geometry, index }) {
      return {
        particle_id: ParticlesTypes.LAVA,
        data: {
          scale: 2,
        },
        visible: index / geometry.vertices.length < progress && progress < 1,
      }
    },
  }
}

export function rainbow_torus_material() {
  return {
    colorize_vertice({ geometry, index }) {
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

export function basic_material({
  color: { red, green, blue },
  scale = 1,
  particle_type = ParticlesTypes.RGB,
}) {
  return {
    colorize_vertice() {
      return {
        particle_id: particle_type,
        data: { red, green, blue, scale },
        visible: true,
      }
    },
  }
}
