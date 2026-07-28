// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1434 RENDERER CRASH — the adapter-fit tier must be the tier the terrain pool is BUILT at.
//
// core/renderer.js steps the boot tier DOWN until its terrain pool can bind on this adapter (S5), then
// requests `maxStorageBufferBindingSize` for THAT tier. The step-down used to mutate only renderer.js's
// own local `tier`: engine.js kept the unfitted tier and handed it to create_terrain_renderer, so on any
// adapter at the WebGPU spec-minimum binding limit (128 MiB) a HIGH boot requested 128 MiB and then
// allocated the 138 MiB HIGH pool against it — an invalid storage bind group, GPUValidationError on every
// terrain draw, and the tab crash the guard exists to prevent. The guard's own LOUD shortfall branch could
// never fire either: it compared the adapter limit against the ALREADY-stepped-down tier's pool.
//
// The invariant this pins is the one the GPU actually enforces: the pool the engine builds must bind
// inside the limit the boot requested for it. `fit_tier_to_adapter` is the single home both sides read.

import { describe, expect, test } from 'bun:test'

import { TIER_LOAD_RADIUS } from '../../src/config/world_config.js'
import { TIER_ORDER } from '../../src/core/quality/tiers.js'
import { fit_tier_to_adapter, max_pool_storage_bytes, resolve_pool_config } from '../../src/render/pool_renderer.js'

/** The WebGPU spec DEFAULT/minimum `maxStorageBufferBindingSize` — what a conformant adapter may report. */
const SPEC_MINIMUM_BINDING_BYTES = 128 * 1024 * 1024

describe('fit_tier_to_adapter — the boot tier a device can actually bind', () => {
  test('a spec-minimum adapter cannot bind the HIGH pool, so HIGH fits down to MEDIUM', () => {
    expect(max_pool_storage_bytes('high')).toBeGreaterThan(SPEC_MINIMUM_BINDING_BYTES)
    expect(fit_tier_to_adapter('high', SPEC_MINIMUM_BINDING_BYTES)).toBe('medium')
  })

  test('a generous adapter keeps every requested tier untouched', () => {
    for (const tier of TIER_ORDER) expect(fit_tier_to_adapter(tier, 4 * 1024 * 1024 * 1024)).toBe(tier)
  })

  test('THE CRASH INVARIANT: the fitted tier’s pool binds within the adapter limit, for every tier × limit', () => {
    const limits = [
      max_pool_storage_bytes('low'), // an adapter that can bind exactly LOW
      SPEC_MINIMUM_BINDING_BYTES,
      max_pool_storage_bytes('high'),
    ]
    for (const requested of TIER_ORDER)
      for (const limit of limits) {
        const fitted = fit_tier_to_adapter(requested, limit)
        expect(max_pool_storage_bytes(fitted)).toBeLessThanOrEqual(limit)
        // never fits UP: a fit only ever degrades quality, it must not promote a tier the caller did not ask for
        expect(TIER_ORDER.indexOf(fitted)).toBeLessThanOrEqual(TIER_ORDER.indexOf(requested))
      }
  })

  test('an adapter below even the LOW pool floors at LOW (loud degradation, never a promoted tier)', () => {
    expect(fit_tier_to_adapter('high', 1024)).toBe(TIER_ORDER[0])
  })
})

/** `quad_pool.js` packs 2 u32 per quad — an INDEPENDENT restatement of pool_renderer's private
 *  QUAD_POOL_BYTES_PER_QUAD, so this file is a real oracle for the alloc↔limit linkage below. */
const BYTES_PER_QUAD = 8

describe('the boot chain reads ONE tier — the #1434 desync', () => {
  test('REGRESSION WITNESS: on a spec-minimum adapter the REQUESTED tier’s pool cannot bind, the FITTED one can', () => {
    const requested = /** @type {const} */ ('high')
    const fitted = fit_tier_to_adapter(requested, SPEC_MINIMUM_BINDING_BYTES)
    expect(fitted).not.toBe(requested)
    // This pair IS the crash: the old boot requested the device limit for `fitted` and then handed
    // `requested` to create_terrain_renderer, so the allocated pool overflowed the granted binding.
    expect(max_pool_storage_bytes(requested)).toBeGreaterThan(SPEC_MINIMUM_BINDING_BYTES)
    expect(max_pool_storage_bytes(fitted)).toBeLessThanOrEqual(SPEC_MINIMUM_BINDING_BYTES)
  })

  test('the device-limit request and the pool allocation are derived from the SAME resolved config', () => {
    // The limit renderer.js requests must be the largest buffer create_terrain_renderer actually
    // allocates at that tier — one home, or the two drift apart again by a different route.
    for (const tier of TIER_ORDER) {
      const largest = Math.max(
        ...Object.values(resolve_pool_config(tier)).map(
          ({ slot_quads, max_slots }) => slot_quads * max_slots * BYTES_PER_QUAD
        )
      )
      expect(max_pool_storage_bytes(tier)).toBe(largest)
    }
  })

  test('the adoption is load-bearing: fitting down also shrinks the streaming ring engine.js sizes', () => {
    // engine.js sizes load_radius/ring_total from the tier it adopts. If it kept the requested tier
    // while the renderer fitted down, the ring would stream a radius the pool was never sized for.
    const fitted = fit_tier_to_adapter('high', SPEC_MINIMUM_BINDING_BYTES)
    expect(TIER_LOAD_RADIUS[fitted]).toBeLessThan(TIER_LOAD_RADIUS.high)
  })
})
