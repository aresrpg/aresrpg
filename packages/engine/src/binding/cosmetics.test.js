// Seam 8 gate — the cosmetic head-slot precedence (SPEC §7.11: hat renders INSTEAD of helmet).

import { test, expect, describe } from 'bun:test'

import { resolve_headgear } from './cosmetics.js'

describe('binding/resolve_headgear — hat > helmet > hair > none', () => {
  test('a cosmetic hat renders INSTEAD of the combat helmet (SPEC §7.11)', () => {
    expect(resolve_headgear({ hat: 'hat.glb', helmet: 'helm.appearance', hair: 'hair.glb' })).toEqual({
      appearance: 'hat.glb',
      source: 'hat',
    })
  })

  test('the helmet wins when no hat is equipped (hair suppressed under it)', () => {
    expect(resolve_headgear({ helmet: 'helm.appearance', hair: 'hair.glb' })).toEqual({
      appearance: 'helm.appearance',
      source: 'helmet',
    })
  })

  test('hair shows only when the head is otherwise bare (the no-helmet path)', () => {
    expect(resolve_headgear({ hair: 'hair.glb' })).toEqual({ appearance: 'hair.glb', source: 'hair' })
  })

  test('a bare head → none', () => {
    expect(resolve_headgear({})).toEqual({ appearance: null, source: 'none' })
    expect(resolve_headgear()).toEqual({ appearance: null, source: 'none' })
    expect(resolve_headgear({ hat: null, helmet: undefined, hair: null })).toEqual({ appearance: null, source: 'none' })
  })

  test('non-string handles pass through (agnostic to what the appearance IS)', () => {
    const hat = { url: 'x' }
    expect(resolve_headgear({ hat }).appearance).toBe(hat)
  })
})
