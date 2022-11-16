/*import { hsl_to_rgb } from '../../color.js'

import { ParticlesTypes } from './particles.js'
import logger from '../../logger.js'

const log = logger(import.meta)

export function rainbow_rainbow_material({ progress }) {
  return {
    colorize_vertice(geometry, vertice, index) {
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
    colorize_vertice(geometry, vertice, index) {
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

export function fire_slash_material({ progress }) {
  return {
    colorize_vertice(geometry, vertice, index) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles
      const side_index = Math.min(
        1,
        index / geometry.vertices.length
      )
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

export function fire_tornado_material({}) {
  return {
    colorize_vertice(geometry, vertice, index) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles
      const side_index = Math.min(
        1,
        index / geometry.vertices.length
      )
      return {
        particle_id: ParticlesTypes.FIRE,
        data: {
          scale: 2,
        },
        visible: side_index < 0 || side_index > 0.75,
      }
    },
  }
}

export function permanent_fire_slash_material({ progress, max_progress = 1}) {
  return {
    colorize_vertice(geometry, vertice, index) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles
      const side_index = Math.min(
        1,
        index / geometry.vertices.length
      )
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
    colorize_vertice(geometry, vertice, index) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles
      const side_index = Math.min(
        1,
        index / geometry.vertices.length
      )
      //log.info(side_index)
      return {
        particle_id: ParticlesTypes.LAVA,
        data: {
          scale: 2,
        },
        visible: index/geometry.vertices.length < progress && progress < 3,
      }
    },
  }
}

export function smoke_material({ progress }) {
  return {
    colorize_vertice(geometry, vertice, index) {
      const circle_index = index % geometry.max_circles
      const h = circle_index / geometry.max_circles
      const side_index = Math.min(
        1,
        index / geometry.segments
      )
      return {
        particle_id: ParticlesTypes.RGB,
        data: {
          color: {red: 0, green: 0, blue: 0},
          scale: 1,
        },
        visible: true//side_index > progress - 0.1 && side_index < progress + 0.1,
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

export function basic_material({ color: { red, green, blue }, scale = 1, particle_type = ParticlesTypes.RGB }) {
  return {
    colorize_vertice(geometry, vertice, index) {
      return {
        particle_id: particle_type,
        data: { red, green, blue, scale },
        visible: true,
      }
    },
  }
}

I HAD TO COMMENT EVERYTHING BECAUSE OF HUSKY*/