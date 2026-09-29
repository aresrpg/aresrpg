import { expect, test } from 'bun:test'

import { stroke_selection, selection_edge_speed } from '../src/selection_geometry.ts'

const cells = [
  { id: 'first', left: 0, top: 0, width: 44, height: 44 },
  { id: 'second', left: 48, top: 0, width: 44, height: 44 },
  { id: 'third', left: 0, top: 48, width: 44, height: 44 },
  { id: 'fourth', left: 48, top: 48, width: 44, height: 44 },
]

test('a stroke selects only crossed cells rather than its bounding rectangle', () => {
  expect(stroke_selection({ x: 10, y: 10 }, { x: 80, y: 80 }, cells, [])).toEqual(['first', 'fourth'])
  expect(stroke_selection({ x: 80, y: 10 }, { x: 10, y: 10 }, cells, [])).toEqual(['first', 'second'])
})

test('later strokes continue the selection without losing earlier items or duplicating them', () => {
  const first = stroke_selection({ x: 10, y: 10 }, { x: 80, y: 10 }, cells, [])
  expect(stroke_selection({ x: 20, y: 70 }, { x: 20, y: 70 }, cells, first)).toEqual(['first', 'second', 'third'])
  expect(stroke_selection({ x: 20, y: 20 }, { x: 20, y: 20 }, cells, first)).toEqual(first)
})

test('edge scrolling is bounded and stops away from the edge', () => {
  expect(selection_edge_speed(200, 400)).toBe(0)
  expect(selection_edge_speed(0, 400)).toBe(-12)
  expect(selection_edge_speed(400, 400)).toBe(12)
})
