// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { draw_city_layer, draw_spawn_markers } from '../../../src/game/hud/map_layers.ts'

test('a visible mob is painted as the red map dot', () => {
  const arcs: unknown[][] = []
  const fills: string[] = []
  let fill_style = ''
  const context = {
    beginPath: () => {},
    arc: (...arguments_: unknown[]) => arcs.push(arguments_),
    fill: () => fills.push(fill_style),
    fillRect: () => {},
    restore: () => {},
    rotate: () => {},
    save: () => {},
    translate: () => {},
    get fillStyle() {
      return fill_style
    },
    set fillStyle(value: string) {
      fill_style = value
    },
  } as unknown as CanvasRenderingContext2D

  draw_spawn_markers(context, { center_x: 0, center_z: 0, size: 100, radius: 50 }, [
    { kind: 'mob', spawn_id: 'nauvis:97:97:s7:m0', x: 0, z: 0, zx: 97, zz: 97, size: 2 },
  ])

  expect(arcs).toEqual([[50, 50, 4.5, 0, Math.PI * 2]])
  expect(fills).toEqual(['#ff6b6b'])
})

test('a city paints its authored border and top-down structure footprints', () => {
  const fills: unknown[][] = []
  const strokes: unknown[][] = []
  const context = {
    fillRect: (...arguments_: unknown[]) => fills.push(arguments_),
    restore: () => {},
    save: () => {},
    setLineDash: () => {},
    strokeRect: (...arguments_: unknown[]) => strokes.push(arguments_),
  } as unknown as CanvasRenderingContext2D

  draw_city_layer(context, { center_x: 0, center_z: 0, size: 256, radius: 128 }, [
    {
      id: 'thebes',
      bounds: { min_x: -64, max_x: 63, min_z: -64, max_z: 63 },
      core: { min_x: -32, max_x: 31, min_z: -32, max_z: 31 },
      structures: [{ id: 'castle', type: 'thebes_castle', bounds: { min_x: -8, max_x: 8, min_z: -8, max_z: 8 } }],
    },
  ])

  expect(strokes).toHaveLength(2)
  expect(fills).toHaveLength(2)
  expect(fills[1]).toEqual([120, 120, 17, 17])
})
