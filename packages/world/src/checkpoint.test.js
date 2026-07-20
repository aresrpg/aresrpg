import { describe, expect, it } from 'bun:test'

import { checkpoint_to_world, resolve_boot_spawn, AGREE_RADIUS_M } from './checkpoint.js'

const WORLD_SPAWN = /** @type {[number, number, number]} */ ([0.5, 131, 0.5])
const [, Y] = WORLD_SPAWN

describe('checkpoint_to_world — chain→world position math (signed offset)', () => {
  it('subtracts the per-world offset (bounds/2) from each chain axis', () => {
    // a small test world: bounds 1700 → offset 850. chain (833, 861) → world (-17, 11).
    expect(checkpoint_to_world({ x: 833, z: 861 }, { bounds_x: 1700, bounds_z: 1700 })).toEqual({ x: -17, z: 11 })
  })

  it('a checkpoint AT the world centre (bounds/2) maps to the world origin', () => {
    expect(checkpoint_to_world({ x: 250_000, z: 250_000 }, { bounds_x: 500_000, bounds_z: 500_000 })).toEqual({
      x: 0,
      z: 0,
    })
  })

  it('produces SIGNED world coords west/north of centre (the codec reason d’être)', () => {
    const w = checkpoint_to_world({ x: 100, z: 200 }, { bounds_x: 1000, bounds_z: 1000 })
    expect(w).toEqual({ x: -400, z: -300 })
  })

  it('falls back to the default offset when the doc has no usable bounds', () => {
    // world_offsets → DEFAULT_WORLD_OFFSET (250_000) per axis when bounds absent.
    expect(checkpoint_to_world({ x: 250_010, z: 249_990 }, null)).toEqual({ x: 10, z: -10 })
  })

  it('returns null for an absent or non-finite checkpoint', () => {
    expect(checkpoint_to_world(null, { bounds_x: 1000, bounds_z: 1000 })).toBeNull()
    expect(checkpoint_to_world({ x: NaN, z: 5 }, { bounds_x: 1000, bounds_z: 1000 })).toBeNull()
  })
})

describe('resolve_boot_spawn — chain checkpoint is the source of truth', () => {
  const cp = { x: 100, z: 200 }

  it('spawns AT the checkpoint (y seeded) when there is no session restore', () => {
    const r = resolve_boot_spawn({ checkpoint: cp, session: null, fallback: WORLD_SPAWN, y_seed: Y })
    expect(r).toEqual({ position: [100, Y, 200], yaw: 0, source: 'checkpoint' })
  })

  it('CHECKPOINT WINS over a local restore that DISAGREES (far from the checkpoint)', () => {
    const far = { x: 100 + AGREE_RADIUS_M + 50, y: 140, z: 200, yaw: 1.2 }
    const r = resolve_boot_spawn({ checkpoint: cp, session: far, fallback: WORLD_SPAWN, y_seed: Y })
    expect(r.source).toBe('checkpoint')
    expect(r.position).toEqual([100, Y, 200])
    expect(r.yaw).toBe(0)
  })

  it('keeps the fine-grained session restore when it AGREES (same area as the checkpoint)', () => {
    const near = { x: 130, z: 190 }
    const r = resolve_boot_spawn({ checkpoint: cp, session: near, fallback: WORLD_SPAWN, y_seed: Y })
    // The localStorage cache deliberately persists x/z only; boot seeds height and yaw, then the existing
    // ground-settle gate finds the real column.
    expect(r).toEqual({ position: [130, Y, 190], yaw: 0, source: 'session' })
  })

  it('falls back to WORLD_SPAWN ONLY when NO checkpoint exists (pre-first-join)', () => {
    const r = resolve_boot_spawn({ checkpoint: null, session: null, fallback: WORLD_SPAWN, y_seed: Y })
    expect(r).toEqual({ position: WORLD_SPAWN, yaw: 0, source: 'fallback' })
  })

  it('with no checkpoint, an x/z-only session restore is still honoured', () => {
    const s = { x: 5, z: 9 }
    const r = resolve_boot_spawn({ checkpoint: null, session: s, fallback: WORLD_SPAWN, y_seed: Y })
    expect(r).toEqual({ position: [5, Y, 9], yaw: 0, source: 'session' })
  })

  it('returns a COPY of the fallback (never the shared WORLD_SPAWN reference)', () => {
    const r = resolve_boot_spawn({ checkpoint: null, session: null, fallback: WORLD_SPAWN, y_seed: Y })
    expect(r.position).not.toBe(WORLD_SPAWN)
    expect(r.position).toEqual(WORLD_SPAWN)
  })
})
