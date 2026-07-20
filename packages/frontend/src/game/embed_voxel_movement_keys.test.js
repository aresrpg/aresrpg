// resolve_movement_key / is_movement_key unit tests — witness-r4 (2026-07-11): "arrow keys don't move the
// world, WASD works". Proves the arrow codes resolve to the IDENTICAL {axis,sign} their WASD partner does
// (embed_voxel_player.js's on_key just reads this map), and that the preventDefault gate (is_movement_key)
// covers exactly the same set — so the page-scroll fix can never silently drift from the movement map.

import { describe, it, expect } from 'bun:test'

import { resolve_movement_key, is_movement_key } from './embed_voxel_movement_keys.js'

describe('resolve_movement_key — the WASD/arrow alias', () => {
  it('ArrowUp resolves to the SAME {axis,sign} as KeyW (forward)', () => {
    expect(resolve_movement_key('ArrowUp')).toEqual(resolve_movement_key('KeyW'))
    expect(resolve_movement_key('KeyW')).toEqual({ axis: 'forward', sign: 1 })
  })

  it('ArrowDown resolves to the SAME {axis,sign} as KeyS (back)', () => {
    expect(resolve_movement_key('ArrowDown')).toEqual(resolve_movement_key('KeyS'))
    expect(resolve_movement_key('KeyS')).toEqual({ axis: 'forward', sign: -1 })
  })

  it('ArrowLeft resolves to the SAME {axis,sign} as KeyA (strafe left)', () => {
    expect(resolve_movement_key('ArrowLeft')).toEqual(resolve_movement_key('KeyA'))
    expect(resolve_movement_key('KeyA')).toEqual({ axis: 'strafe', sign: -1 })
  })

  it('ArrowRight resolves to the SAME {axis,sign} as KeyD (strafe right)', () => {
    expect(resolve_movement_key('ArrowRight')).toEqual(resolve_movement_key('KeyD'))
    expect(resolve_movement_key('KeyD')).toEqual({ axis: 'strafe', sign: 1 })
  })

  it('a non-movement key (fight/mount/cinematic keys, letters) resolves to null', () => {
    for (const code of ['Space', 'KeyC', 'Digit1', 'Numpad1', 'ShiftLeft', 'ShiftRight', 'KeyE', 'Escape'])
      expect(resolve_movement_key(code)).toBeNull()
  })
})

describe('is_movement_key — the preventDefault gate (stops the arrow-key page-scroll)', () => {
  it('is true for WASD and all four arrows — the exact set on_key preventDefault()s', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
      expect(is_movement_key(code)).toBe(true)
  })

  it('is false for unrelated keys (never swallows a key that is not ours to take)', () => {
    for (const code of ['Space', 'KeyC', 'Digit1', 'Numpad1', 'ShiftLeft']) expect(is_movement_key(code)).toBe(false)
  })
})
