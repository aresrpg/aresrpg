// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { detail_builder } from '../../detail_builder.ts'
import type { Vec3 } from '../../types.ts'

import { in_reserved_plot, type ThebesLayout } from './plan.ts'
import { THEBES_MATERIALS as M } from './materials.ts'
export type CityDetails = ReturnType<typeof detail_builder>

const railing = (details: CityDetails, a: Vec3, b: Vec3): void => {
  const count = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 4)
  const point = (t: number, h: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t + h,
    a[2] + (b[2] - a[2]) * t,
  ]
  for (let i = 0; i <= count; i++) details.beam(point(i / count, 0), point(i / count, 2), 0.3, 0.3, M.timber)
  for (const h of [0.7, 1.8]) details.beam(point(0, h), point(1, h), 0.18, 0.24, M.timber)
}
const lamp = (d: CityDetails, [x, y, z]: Vec3): void => {
  d.beam([x, y, z], [x, y + 5, z], 0.3, 0.3, M.timber)
  d.beam([x, y + 5, z], [x + 1.6, y + 5, z], 0.2, 0.2, M.timber)
  d.rope([x + 1.4, y + 5, z], [x + 1.4, y + 4.5, z], 0, 0.06, M.copper)
  d.box([x + 1.05, y + 3.5, z - 0.35], [x + 1.75, y + 4.5, z + 0.35], M.lantern)
  for (const dx of [1, 1.8])
    for (const dz of [-0.4, 0.4]) d.beam([x + dx, y + 3.4, z + dz], [x + dx, y + 4.6, z + dz], 0.12, 0.12, M.timber)
  d.box([x + 0.9, y + 4.6, z - 0.5], [x + 1.9, y + 4.8, z + 0.5], M.tile)
}
export const dress_thebes = (d: CityDetails, layout: ThebesLayout): void => {
  layout.bridges.forEach(({ start, end, width }) => {
    for (const side of [-1, 1]) {
      const offset = side * Math.floor(width / 2)
      railing(d, [start[0] + offset, start[1] + 1, start[2]], [end[0] + offset, end[1] + 1, end[2]])
      lamp(d, [start[0] + offset, start[1] + 1, start[2]])
      lamp(d, [end[0] + offset, end[1] + 1, end[2]])
    }
  })
  layout.routes.forEach((route) =>
    route.slice(1).forEach((end, index) => {
      const start = route[index]!,
        length = Math.hypot(end[0] - start[0], end[2] - start[2])
      const count = Math.floor(length / 32)
      for (let i = 0; i < count; i++) {
        const point: Vec3 = [
          start[0] + ((end[0] - start[0]) * i) / count + 6,
          start[1] + ((end[1] - start[1]) * i) / count,
          start[2] + ((end[2] - start[2]) * i) / count + 6,
        ]
        if (
          Math.hypot(point[0] - layout.arrival[0], point[2] - layout.arrival[1]) > 20 &&
          !in_reserved_plot(layout, point[0], point[2])
        )
          lamp(d, point)
      }
    })
  )
  layout.terraces
    .filter((t) => t.id === 'fields' || t.id === 'orchard')
    .forEach((t) => {
      for (const z of [t.min_z, t.max_z]) railing(d, [t.min_x, t.height, z], [t.max_x, t.height, z])
    })
}
