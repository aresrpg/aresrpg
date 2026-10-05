import { expect, test } from 'bun:test'

import { roll_quality } from '../src/roll_quality.ts'

test('the strict threshold excludes exactly 90% and ignores fixed bonuses', () => {
  const ranges = {
    min: { vitality: 10, intelligence: 10, action: 1 },
    max: { vitality: 110, intelligence: 20, action: 1 },
  }
  expect(roll_quality(ranges, { vitality: 90, intelligence: 20, action: 1 })).toEqual({
    basis_points: 9000,
    exceptional: false,
  })
  expect(roll_quality(ranges, { vitality: 91, intelligence: 20, action: 1 })).toEqual({
    basis_points: 9050,
    exceptional: true,
  })
})
test('negative penalties improve towards zero, and fixed-only items have no random quality', () => {
  expect(roll_quality({ min: { vitality: -20 }, max: { vitality: -10 } }, { vitality: -10 })?.exceptional).toBe(true)
  expect(roll_quality({ min: { vitality: 10 }, max: { vitality: 10 } }, { vitality: 10 })).toBeNull()
})
test('each variable stat has equal weight and missing rolls are rejected', () => {
  const ranges = { min: { vitality: 0, action: 0 }, max: { vitality: 1000, action: 1 } }
  expect(roll_quality(ranges, { vitality: 1000, action: 0 })?.basis_points).toBe(5000)
  expect(() => roll_quality(ranges, { vitality: 1000 })).toThrow('Invalid item roll')
})
