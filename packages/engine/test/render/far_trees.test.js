// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAR-TREE IMPOSTOR render-half wiring tests (ENGINE_AAA_PLAN §8 B3). No GPU: builds the handle + its
// TSL materials in bun exactly as far_field.test.js does, and drives the per-section lifecycle (upload /
// count / instance attributes / spawn stamping / remove / retire+reap cross-fade). Pixel proof (forests
// to the horizon, ring cross-fade, ms budget, reload mask) is bench/impostors_poses.spec.js [retired, issue #74] on the GPU.

import { test, expect, describe } from 'bun:test'
import { DataTexture, RedFormat, UnsignedByteType, Vector2 } from 'three'
import { uniform } from 'three/tsl'

import { create_far_trees } from '../../src/render/far_trees.js'

/** Mock scene capturing add/remove so the test can inspect the impostor meshes. */
function mock_scene() {
  /** @type {any[]} */
  const added = []
  return {
    added,
    scene: /** @type {*} */ ({
      add: (/** @type {any} */ m) => added.push(m),
      remove: (/** @type {any} */ m) => {
        const i = added.indexOf(m)
        if (i >= 0) added.splice(i, 1)
      },
    }),
  }
}

/** Builds a handle over a mock scene + shared uniforms (mirrors far_field's private state). */
function make(clock_value = 0) {
  const { added, scene } = mock_scene()
  const clock = uniform(clock_value)
  const mask_texture = new DataTexture(new Uint8Array(41 * 41), 41, 41, RedFormat, UnsignedByteType)
  const mask_origin = uniform(new Vector2(0, 0))
  const trees = create_far_trees({ scene, clock, mask_texture, mask_origin, mask_chunks: 41 })
  return { trees, added, clock }
}

// 2 trees, IMPOSTOR_FLOATS_PER_TREE=6 each: [wx, base_y, wz, w, h, layer].
const TWO = { count: 2, data: new Float32Array([10, 64, 20, 5, 8, 0, 30, 66, 40, 6, 9, 5]) }

describe('far-tree impostor renderer lifecycle', () => {
  test('constructs without a GPU (atlas bake + TSL materials build in bun)', () => {
    const { trees } = make()
    expect(trees.count()).toBe(0)
    expect(() => trees.set_near_radius(224)).not.toThrow()
    trees.dispose()
  })

  test('upload_section builds one instanced batch, stamps spawn, counts trees', () => {
    const { trees, added, clock } = make()
    clock.value = 3
    trees.upload_section('a', TWO, clock.value)
    expect(trees.count()).toBe(2)
    expect(added.length).toBe(1)
    const g = added[0].geometry
    expect(g.instanceCount).toBe(2)
    expect(Array.from(g.getAttribute('i_base').array.slice(0, 3))).toEqual([10, 64, 20]) // first tree base
    expect(Array.from(g.getAttribute('i_layer').array)).toEqual([0, 5]) // per-species×age atlas layer
    expect(Array.from(g.getAttribute('i_spawn').array)).toEqual([3, 3]) // dithers IN from the spawn clock
    trees.dispose()
  })

  test('empty tree set is a no-op (a section the worker derived nothing for)', () => {
    const { trees, added } = make()
    trees.upload_section('e', { count: 0, data: new Float32Array(0) }, 0)
    expect(trees.count()).toBe(0)
    expect(added.length).toBe(0)
  })

  test('re-upload replaces in place; remove drops accounting immediately', () => {
    const { trees, added } = make()
    trees.upload_section('a', TWO, 0)
    trees.upload_section('a', { count: 1, data: new Float32Array([1, 2, 3, 4, 5, 1]) }, 0) // replace
    expect(trees.count()).toBe(1)
    expect(added.length).toBe(1)
    trees.remove_section('a')
    expect(trees.count()).toBe(0)
    expect(added.length).toBe(0)
    trees.reap(0)
    trees.dispose()
  })

  test('removal detaches now and frees the geometry on the next reap tick', () => {
    const { added, scene } = mock_scene()
    const clock = uniform(0)
    const mask_texture = new DataTexture(new Uint8Array(41 * 41), 41, 41, RedFormat, UnsignedByteType)
    const mask_origin = uniform(new Vector2())
    let frees = 0
    const trees = create_far_trees({
      scene,
      clock,
      mask_texture,
      mask_origin,
      mask_chunks: 41,
      on_geometry_disposed: () => {
        frees += 1
      },
    })
    trees.upload_section('a', TWO, 0)
    const [{ geometry }] = added
    let dispose_events = 0
    geometry.addEventListener('dispose', () => {
      dispose_events += 1
    })
    trees.remove_section('a')
    expect(added.length).toBe(0)
    expect(dispose_events).toBe(0)
    trees.reap(0)
    expect(dispose_events).toBe(1)
    expect(frees).toBe(1)
    trees.dispose()
  })

  test('retire cross-fades: count drops now, the batch lingers until its fade-out completes then is reaped', () => {
    const { trees, added, clock } = make()
    clock.value = 5
    trees.upload_section('a', TWO, 5)
    trees.retire_section('a')
    expect(trees.count()).toBe(0) // accounting immediate…
    expect(added.length).toBe(1) // …but still rendering (dying material) for the cross-fade
    // its spawn was rebaked to the retire clock so the DYING material starts its 1→0 dither now
    expect(Array.from(added[0].geometry.getAttribute('i_spawn').array)).toEqual([5, 5])
    trees.reap(0) // clock still 5 → within the fade window → kept
    expect(added.length).toBe(1)
    clock.value = 5.5 // past retire + FADE_SECONDS
    trees.reap(0)
    expect(added.length).toBe(0) // freed
    trees.dispose()
  })
})
