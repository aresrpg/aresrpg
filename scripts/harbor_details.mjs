// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import workshop from '../seed/structures/workshop.recipe.json' with { type: 'json' }
import kit from '../seed/structures/harbor_details.json' with { type: 'json' }

/** Content composition only. Every part is baked through the same engine geometry builder. */
export const harbor_lamp = (details, glows, x, y, z, range) => {
  const local = details.transformed(([px, py, pz]) => [x + px, y + py, z + pz])
  local.beam([0, 0, 0], [0, 7.5, 0], 0.45, 0.45, 'trim')
  local.beam([0, 7.2, 0], [2.5, 7.2, 0], 0.3, 0.3, 'trim')
  local.beam([0, 5.7, 0], [1.5, 7.2, 0], 0.18, 0.18, 'brass')
  local.rope([2.3, 7.2, 0], [2.3, 6.1, 0], 0, 0.065, 'trim')
  kit.lantern.forEach(({ min, max, material }) => {
    local.box([min[0] + 2.3, min[1] + 3.8, min[2]], [max[0] + 2.3, max[1] + 3.8, max[2]], material)
  })
  glows.push({ center: [x + 2.3, y + 4.7, z], size: 2.2, color: [2.8, 1, 0.2], ...(range ? { range } : {}) })
}

export const harbor_railing = (details, start, end) => {
  const length = Math.hypot(end[0] - start[0], end[2] - start[2])
  const segments = Math.max(1, Math.ceil(length / 4))
  const point = (t, h) => start.map((v, i) => v + (end[i] - v) * t + (i === 1 ? h : 0))
  for (let index = 0; index <= segments; index++) {
    const top = point(index / segments, 2.2)
    details.beam(point(index / segments, 0), top, 0.35, 0.35, 'trim')
    details.box([top[0] - 0.27, top[1], top[2] - 0.27], [top[0] + 0.27, top[1] + 0.18, top[2] + 0.27], 'snow')
  }
  details.beam(point(0, 2), point(1, 2), 0.24, 0.3, 'wood')
  details.beam(point(0, 0.8), point(1, 0.8), 0.16, 0.2, 'wood')
}

/** Billowed opaque canvas, two faces and a sewn border; no transparency or per-frame cloth simulation. */
export const harbor_canvas = (details, { x, y, z, width, height, material }) => {
  const point = (u, v) => [
    x + u * width,
    y - v * height,
    z + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * width * 0.13,
  ]
  for (let column = 0; column < 6; column++) {
    for (let row = 0; row < 6; row++) {
      const a = point(column / 6, row / 6)
      const b = point((column + 1) / 6, row / 6)
      const c = point((column + 1) / 6, (row + 1) / 6)
      const d = point(column / 6, (row + 1) / 6)
      details.quad(a, b, c, d, material)
      details.quad(d, c, b, a, material)
    }
  }
  details.beam(point(0, 0), point(1, 0), 0.16, 0.16, 'wood')
  details.rope(point(0, 0), point(0, 1), 0, 0.06, 'rope')
  details.rope(point(1, 0), point(1, 1), 0, 0.06, 'rope')
}

/** The harbor uses the same AresRPG heraldry as the city and workshop. */
export const harbor_banner = (details, x, y, z, scale = 1) => {
  const palette = {
    iron: 'trim',
    cloth_dark: 'trim',
    cloth_gold: 'brass',
    cloth_steel: 'snow',
    cloth_cyan: 'blue_roof',
  }
  for (const [operation, ...args] of workshop.assets.banner.details)
    details[operation](
      ...args.map((value) =>
        Array.isArray(value)
          ? value.map((coordinate, axis) => coordinate * scale + [x, y, z][axis])
          : typeof value === 'number'
            ? value * scale
            : (palette[value] ?? value)
      )
    )
}
