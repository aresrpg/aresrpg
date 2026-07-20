import { describe, expect, it } from 'bun:test'

// No mocking needed — get_block_by_id (@aresrpg/engine3/player) is a pure, real lookup (the same pattern
// world_board_seat.test.js uses for ground_surface_y/seat_surface_y): exercise it against REAL registry
// ids so a future registry edit that silently breaks a step tag fails a test, not just an ear.
import { resolve_footstep_class, is_water_block } from './ground_material.js'

describe('resolve_footstep_class — block id -> footstep timbre (reuses block_registry sounds.step)', () => {
  it('grass (3) and leaves (7) resolve to soft', () => {
    expect(resolve_footstep_class(3)).toBe('soft')
    expect(resolve_footstep_class(7)).toBe('soft')
  })

  it('dirt (2) resolves to dull', () => {
    expect(resolve_footstep_class(2)).toBe('dull')
  })

  it('stone (1), glowstone (9), cave_stone (18) and mossy_stone (19) resolve to sharp', () => {
    expect(resolve_footstep_class(1)).toBe('sharp')
    expect(resolve_footstep_class(9)).toBe('sharp')
    expect(resolve_footstep_class(18)).toBe('sharp')
    expect(resolve_footstep_class(19)).toBe('sharp')
  })

  it('sand (4) resolves to granular', () => {
    expect(resolve_footstep_class(4)).toBe('granular')
  })

  it('log (6) resolves to knock', () => {
    expect(resolve_footstep_class(6)).toBe('knock')
  })

  it('snow (8) resolves to muffled', () => {
    expect(resolve_footstep_class(8)).toBe('muffled')
  })

  it('water (5) resolves to wading via the step tag alone', () => {
    expect(resolve_footstep_class(5)).toBe('wading')
  })

  it('air (0, step tag "none") and any unknown/invalid id default to dull — never throws, never silent', () => {
    expect(resolve_footstep_class(0)).toBe('dull')
    expect(resolve_footstep_class(99999)).toBe('dull')
    expect(resolve_footstep_class(-1)).toBe('dull')
  })
})

describe('is_water_block — the shared liquid check (footstep wading override + water-ambience proximity)', () => {
  it('water (5) is true', () => {
    expect(is_water_block(5)).toBe(true)
  })

  it('a solid block (stone, 1) and air (0) are false', () => {
    expect(is_water_block(1)).toBe(false)
    expect(is_water_block(0)).toBe(false)
  })

  it('an unknown id is false, never throws', () => {
    expect(is_water_block(99999)).toBe(false)
  })
})
