// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { checkpoint_to_world, pose_agrees, resolve_boot_spawn } from '../src/checkpoint.js'

const WORLD_SPAWN = /** @type {[number, number, number]} */ ([0.5, 131, 0.5])
const [, Y] = WORLD_SPAWN

// The live worlds' dial (move/scripts/apply_speed_budget.mjs): 11.5 blocks/s ×100 = engine RUN_SPEED + slack.
const SPEED_BUDGET = 1150
const T0 = 1_700_000_000_000 // the chain clock at the checkpoint write

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

// ── #2231: the agreement rule is the CHAIN's time budget, not a flat radius ───────────────────────────────
describe('pose_agrees — the chain travel budget, never a radius', () => {
  const cp = { x: 0, z: 0, time_ms: T0, speed_budget: SPEED_BUDGET }

  it('accepts a LONG walk the chain would accept (past any fixed radius, inside the elapsed budget)', () => {
    // 900 blocks out — far past the retired 512-block radius — after 120s of walking: budget 1380 blocks.
    expect(pose_agrees({ x: 900, z: 0 }, cp, T0 + 120_000)).toBe(true)
  })

  it('REFUSES the same distance the chain would refuse (the teleport shape: too far for the elapsed time)', () => {
    // the identical 900-block pose, 10s after the checkpoint: budget 115 blocks — abort 121 on the next tx.
    expect(pose_agrees({ x: 900, z: 0 }, cp, T0 + 10_000)).toBe(false)
  })

  it('refuses a SHORT hop a flat radius would have waved through', () => {
    // 300 blocks one second after a search: radius-legal under the old rule, chain-illegal (11 blocks).
    expect(pose_agrees({ x: 300, z: 0 }, cp, T0 + 1_000)).toBe(false)
  })

  it('grants the mount budget when the checkpoint was written with a pet equipped (§17.2)', () => {
    const mounted = { ...cp, pet_equipped: true }
    // 1500 blocks in 120s: 1380 on foot (refused) → 2070 mounted (accepted).
    expect(pose_agrees({ x: 1500, z: 0 }, cp, T0 + 120_000)).toBe(false)
    expect(pose_agrees({ x: 1500, z: 0 }, mounted, T0 + 120_000)).toBe(true)
  })

  it('refuses a clock regression exactly as the chain aborts it', () => {
    expect(pose_agrees({ x: 1, z: 0 }, cp, T0 - 1)).toBe(false)
  })

  it('keeps the local pose when the anchor carries no clock or no budget (unjudgeable, never a silent yank)', () => {
    expect(pose_agrees({ x: 9_000, z: 0 }, { x: 0, z: 0, speed_budget: SPEED_BUDGET }, T0)).toBe(true)
    expect(pose_agrees({ x: 9_000, z: 0 }, { x: 0, z: 0, time_ms: T0 }, T0 + 1_000)).toBe(true)
  })

  it('is false when either side is missing', () => {
    expect(pose_agrees(null, cp, T0)).toBe(false)
    expect(pose_agrees({ x: 1, z: 1 }, null, T0)).toBe(false)
    expect(pose_agrees({ x: NaN, z: 1 }, cp, T0)).toBe(false)
  })
})

describe('resolve_boot_spawn — chain checkpoint is the source of truth', () => {
  const cp = { x: 100, z: 200, time_ms: T0, speed_budget: SPEED_BUDGET }

  it('spawns AT the checkpoint (y seeded) when there is no session restore', () => {
    const r = resolve_boot_spawn({ checkpoint: cp, session: null, fallback: WORLD_SPAWN, y_seed: Y, now: T0 })
    expect(r).toEqual({ position: [100, Y, 200], yaw: 0, source: 'checkpoint' })
  })

  it('CHECKPOINT WINS over a local restore the chain would refuse (too far for the elapsed time)', () => {
    const far = { x: 1_000, z: 200, y: 140, yaw: 1.2 } // 900 blocks in 10s — budget 115
    const r = resolve_boot_spawn({ checkpoint: cp, session: far, fallback: WORLD_SPAWN, y_seed: Y, now: T0 + 10_000 })
    expect(r.source).toBe('checkpoint')
    expect(r.position).toEqual([100, Y, 200])
    expect(r.yaw).toBe(0)
  })

  it('#2231 — KEEPS the long walker: 900 blocks out is chain-legal after two minutes, so no snap back', () => {
    const far = { x: 1_000, z: 200, y: 140, yaw: 1.2 }
    const r = resolve_boot_spawn({ checkpoint: cp, session: far, fallback: WORLD_SPAWN, y_seed: Y, now: T0 + 120_000 })
    expect(r).toEqual({ position: [1_000, 140, 200], yaw: 1.2, source: 'session' })
  })

  it('keeps the fine-grained session restore when it AGREES (a few blocks from the checkpoint)', () => {
    const near = { x: 130, z: 190 }
    const r = resolve_boot_spawn({ checkpoint: cp, session: near, fallback: WORLD_SPAWN, y_seed: Y, now: T0 + 10_000 })
    // The persisted row deliberately carries x/z only; boot seeds height and yaw, then the existing
    // ground-settle gate finds the real column.
    expect(r).toEqual({ position: [130, Y, 190], yaw: 0, source: 'session' })
  })

  it('a RETURN ANCHOR restore (#2174) outranks the checkpoint whatever the budget says', () => {
    const far = { x: 5_000, z: 200, return_anchor: true }
    const r = resolve_boot_spawn({ checkpoint: cp, session: far, fallback: WORLD_SPAWN, y_seed: Y, now: T0 + 1_000 })
    expect(r.source).toBe('session')
  })

  it('falls back to WORLD_SPAWN ONLY when NO checkpoint exists (pre-first-join)', () => {
    const r = resolve_boot_spawn({ checkpoint: null, session: null, fallback: WORLD_SPAWN, y_seed: Y, now: T0 })
    expect(r).toEqual({ position: WORLD_SPAWN, yaw: 0, source: 'fallback' })
  })

  it('with no checkpoint, an x/z-only session restore is still honoured', () => {
    const s = { x: 5, z: 9 }
    const r = resolve_boot_spawn({ checkpoint: null, session: s, fallback: WORLD_SPAWN, y_seed: Y, now: T0 })
    expect(r).toEqual({ position: [5, Y, 9], yaw: 0, source: 'session' })
  })

  it('returns a COPY of the fallback (never the shared WORLD_SPAWN reference)', () => {
    const r = resolve_boot_spawn({ checkpoint: null, session: null, fallback: WORLD_SPAWN, y_seed: Y, now: T0 })
    expect(r.position).not.toBe(WORLD_SPAWN)
    expect(r.position).toEqual(WORLD_SPAWN)
  })
})
