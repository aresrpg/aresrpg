// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D193 — the CPU recolor compositor math, pinned against the legacy shader semantics
// (customizable-texture.js fragment + blend state): alpha<0.5 discard, src.rgb·color srcAlpha-blend,
// accumulator alpha untouched.
import { describe, expect, test } from 'bun:test'
import {
  AnimationClip,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NumberKeyframeTrack,
  Texture,
} from 'three'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

import { apply_pixel_filter } from './mob_model.js' // [one-mob-sdk 2026-07-13] moved to the single mob-render home

// MISSING-ARTIFACT (#117): character_avatar.js resolves the absent-by-design senshi_male.glb via a static
// Vite `?url` import (test_helpers/glb_fixture.js) — the module cannot load without the file PRESENT on
// disk, even though these tests mock the GLTF factory and never read its bytes. character_controller.js
// re-exports the same file (D193 "ONE home"), so it is equally poisoned. apply_pixel_filter (below) lives
// in mob_model.js, which is clean, and keeps running for real.
const { compose_pixels, create_character_avatar } = SENSHI_MALE_GLB_AVAILABLE
  ? await import('./character_avatar.js')
  : {}
const { create_character_controller } = SENSHI_MALE_GLB_AVAILABLE ? await import('./character_controller.js') : {}

const px = (/** @type {number[]} */ ...vals) => new Uint8ClampedArray(vals)

const constant_clip = (/** @type {string} */ name, /** @type {number} */ x) =>
  new AnimationClip(name, 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [x, x])])

/** Synthetic fully submerged world (water block id 5) for the controller→avatar contract. */
const underwater_controller = () =>
  create_character_controller({ sample_block: () => 5, position: [0.5, 5, 0.5], yaw: 0 })

/** @param {[string, number][]} specs */
async function load_fake_avatar(specs) {
  const model = new Group()
  const avatar = create_character_avatar({
    mob_model_factory: async () => ({
      root: model,
      clips: specs.map(([name, x]) => constant_clip(name, x)),
      measured: { height: 1, min_y: 0 },
      dispose() {},
    }),
  })
  await Bun.sleep(0)
  expect(avatar.ready).toBe(true)
  return { avatar, model }
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('character avatar swim clip selection', () => {
  test('prefers a dedicated SWIM clip when the rig has one', async () => {
    const { avatar, model } = await load_fake_avatar([
      ['IDLE', 0],
      ['RUN', 10],
      ['SWIM', 20],
    ])
    avatar.update('SWIM', 0, 0.3)
    expect(model.position.x).toBe(20)
    avatar.dispose()
  })

  test('falls back to WALK while moving underwater when no SWIM clip exists', async () => {
    const { avatar, model } = await load_fake_avatar([
      ['IDLE', 0],
      ['WALK', 5],
      ['RUN', 10],
    ])
    const controller = underwater_controller()
    controller.set_input({ forward: 1 })
    controller.tick(1 / 60)
    const transform = controller.get_transform()
    expect(transform.in_water).toBe(true)
    expect(transform.speed).toBeGreaterThan(0.5)
    expect(transform.anim).toBe('SWIM')
    avatar.update(transform.anim, transform.facing_yaw, 0.3)
    expect(model.position.x).toBe(5)
    controller.dispose()
    avatar.dispose()
  })

  test('keeps IDLE while stationary underwater', async () => {
    const { avatar, model } = await load_fake_avatar([
      ['IDLE', 0],
      ['WALK', 5],
      ['RUN', 10],
    ])
    const controller = underwater_controller()
    controller.tick(1 / 60)
    const transform = controller.get_transform()
    expect(transform.in_water).toBe(true)
    expect(transform.speed).toBe(0)
    expect(transform.anim).toBe('IDLE')
    avatar.update(transform.anim, transform.facing_yaw, 0.3)
    expect(model.position.x).toBe(0)
    controller.dispose()
    avatar.dispose()
  })

  test('keeps land RUN selection unchanged', async () => {
    const { avatar, model } = await load_fake_avatar([
      ['IDLE', 0],
      ['WALK', 5],
      ['RUN', 10],
    ])
    avatar.update('RUN', 0, 0.3)
    expect(model.position.x).toBe(10)
    avatar.dispose()
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('compose_pixels (legacy shader port)', () => {
  test('mask alpha < 0.5 discards (base untouched)', () => {
    const out = px(10, 20, 30, 255)
    compose_pixels(out, px(200, 200, 200, 127), [1, 1, 1])
    expect([...out]).toEqual([10, 20, 30, 255])
  })

  test('opaque mask replaces rgb with mask·color, alpha kept', () => {
    const out = px(10, 20, 30, 200)
    compose_pixels(out, px(200, 100, 50, 255), [0.5, 1, 1])
    // src.rgb·color at full alpha: [100, 100, 50]; alpha stays the base's 200
    expect([...out]).toEqual([100, 100, 50, 200])
  })

  test('semi-transparent mask blends src over base (srcAlpha/oneMinusSrcAlpha)', () => {
    const out = px(0, 0, 0, 255)
    compose_pixels(out, px(255, 255, 255, 128), [1, 0, 0]) // half-alpha red-tinted white
    const sa = 128 / 255
    expect(out[0]).toBe(Math.round(255 * 1 * sa)) // red channel: 255·1·sa + 0·(1−sa)
    expect(out[1]).toBe(0) // green: 255·0·sa = 0
    expect(out[3]).toBe(255) // alpha untouched
  })

  test('layers stack in order (later layer paints over earlier)', () => {
    const out = px(10, 10, 10, 255)
    compose_pixels(out, px(255, 0, 0, 255), [1, 1, 1]) // layer 1: red
    compose_pixels(out, px(0, 255, 0, 255), [1, 1, 1]) // layer 2: green wins
    expect([...out].slice(0, 3)).toEqual([0, 255, 0])
  })
})

// [S-82 regression] 2026-07-12 re-verify: apply_pixel_filter is the ONLY thing standing between a
// reference-corpus mob atlas and three.js's default LinearFilter smear (reported: "washed, no eyes"
// class). Pin its actual effect so a future refactor can't silently drop a field again.
describe('apply_pixel_filter (S-82 mob-only NearestFilter)', () => {
  test('sets Nearest mag / mipmapped-linear min / mipmaps / anisotropy on a mesh map', () => {
    const map = new Texture()
    const mesh = new Mesh(undefined, new MeshStandardMaterial({ map }))
    apply_pixel_filter(mesh)
    expect(map.magFilter).toBe(NearestFilter)
    expect(map.minFilter).not.toBe(LinearFilter) // mipmapped-linear min (clean at distance, no shimmer)
    expect(map.generateMipmaps).toBe(true)
    expect(map.anisotropy).toBe(8)
  })

  test('applies to every material in an array-material mesh', () => {
    const map_a = new Texture()
    const map_b = new Texture()
    const mesh = new Mesh(undefined, [
      new MeshStandardMaterial({ map: map_a }),
      new MeshStandardMaterial({ map: map_b }),
    ])
    apply_pixel_filter(mesh)
    expect(map_a.magFilter).toBe(NearestFilter)
    expect(map_b.magFilter).toBe(NearestFilter)
  })

  test('idempotent — a second pass on an already-keyed (shared/cloned) texture is a no-op, never throws', () => {
    const map = new Texture()
    const mesh = new Mesh(undefined, new MeshStandardMaterial({ map }))
    apply_pixel_filter(mesh)
    map.anisotropy = 1 // simulate something re-reading the shared texture after the first pass
    apply_pixel_filter(mesh)
    expect(map.magFilter).toBe(NearestFilter)
    expect(map.anisotropy).toBe(1) // guard skipped it — the shared texture is left alone the 2nd time
  })

  test('a mesh with no map is a safe no-op', () => {
    const mesh = new Mesh(undefined, new MeshStandardMaterial())
    expect(() => apply_pixel_filter(mesh)).not.toThrow()
  })

  test('a sampler-carrying GLB texture (already Nearest at parse) still receives the min/aniso policy', () => {
    // [mob-crisp 2026-07-13] the GLB converter now EMITS mag-NEAREST samplers, so GLTFLoader hands this
    // hook an already-Nearest map. The old `magFilter === NearestFilter` guard skipped those entirely —
    // silently dropping anisotropy=8 (the fight-board grazing-angle smear fix). Guard is a key flag now.
    const map = new Texture()
    map.magFilter = NearestFilter // as parsed from the emitted glTF sampler
    const mesh = new Mesh(undefined, new MeshStandardMaterial({ map }))
    apply_pixel_filter(mesh)
    expect(map.anisotropy).toBe(8)
    expect(map.generateMipmaps).toBe(true)
  })
})
