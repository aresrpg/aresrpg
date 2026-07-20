// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit tests for the render policy used inside create_mob_model. The real rabbit-GLB cross-context proof lives
// in tactical/mob_render_parity.test.js; these synthetic meshes isolate scaling/material edge cases GPU-free.
//
// [mob-sizes-authored 2026-07-13] ruling ("sizes should be true to source") split the scale policy
// in two: an explicit `target_height` still divides-and-retargets (the PLAYER path — CHARACTER_HEIGHT / the
// fight-board's BOARD_PLAYER_HEIGHT); OMITTING it (every mob path, now) takes the NEW intrinsic branch —
// measured GLB height × HYTALE_BLOCKS_PER_GLB_UNIT (0.5: the shipped GLBs are 2× world blocks, calibrated on
// the player-sized humanoids — skeleton/zombie rigs measure 3.6-3.8 GLB units and must stand ~1.8-1.9 blocks
// beside the 2.0 player) — then clamped into [MOB_MIN_H=0.35, MOB_MAX_H=3.2] with a one-line warn.
import { describe, expect, spyOn, test } from 'bun:test'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, NearestFilter, Texture, Vector3 } from 'three'

import { prepare_mob_render } from './mob_model.js'

/** A synthetic rig: one box mesh `height` blocks tall (bbox centred on origin) under a Group root, with a
 *  mapped MeshStandardMaterial (metalness 1 so the gold-kill has something to zero) — the minimum
 *  prepare_mob_render measures + re-materials. @param {number} height @param {number} [metalness] */
function make_rig(height, metalness = 1) {
  const map = new Texture()
  const mat = new MeshStandardMaterial({ map, metalness })
  const mesh = new Mesh(new BoxGeometry(1, height, 1), mat)
  const root = new Group()
  root.add(mesh)
  return { root, mesh, map, mat }
}

const measured_height = (/** @type {Group} */ root) => new Box3().setFromObject(root).getSize(new Vector3()).y

describe('prepare_mob_render — the one-mob-sdk render policy', () => {
  test('PLAYER path — target_height given: height-normalises (divides out the rig intrinsic height, never a raw multiply)', () => {
    const { root } = make_rig(4) // a 4-block-tall intrinsic GLB
    const r = prepare_mob_render(root, { target_height: 1.4 })
    expect(r.height).toBeCloseTo(1.4, 3) // returned extent
    expect(measured_height(root)).toBeCloseTo(1.4, 3) // and the actual scaled bbox
  })

  test('PLAYER path — a 3.16-unit rig lands at an explicit 1.4-block target_height, not 3.16×1.4≈4.4', () => {
    const { root } = make_rig(3.16)
    prepare_mob_render(root, { target_height: 1.4 })
    expect(measured_height(root)).toBeCloseTo(1.4, 2)
    expect(measured_height(root)).toBeLessThan(2) // never the ~4.4-block giant a raw ×1.4 drew
  })

  // ── [mob-sizes-authored 2026-07-13] MOB path: target_height OMITTED ⇒ ×0.5 calibration + clamp ────
  test('MOB path — target_height omitted: GLB height × 0.5 stands (frog: 1.194 GLB units ⇒ 0.597 blocks, knee-high)', () => {
    const { root } = make_rig(1.194) // hy_frog_green_variant's real measured GLB height
    const r = prepare_mob_render(root, {})
    expect(r.height).toBeCloseTo(0.597, 3)
    expect(measured_height(root)).toBeCloseTo(0.597, 3)
    expect(root.scale.x).toBeCloseTo(0.5, 5) // pure unit calibration — no per-mob retarget
  })

  test('MOB path — a player-sized HUMANOID GLB (skeleton, 3.72 units) lands in the player band (~1.86), NOT 2× the player', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const { root } = make_rig(3.72) // hy_skeleton_sand/white's real measured GLB height — the calibration anchor
    const r = prepare_mob_render(root, {})
    expect(r.height).toBeCloseTo(1.86, 3)
    expect(warn).not.toHaveBeenCalled() // in-band, no clamp
    warn.mockRestore()
  })

  test('MOB path — a giant boss (dragon_fire, 8.209 units ⇒ 4.10 blocks) clamps DOWN to MOB_MAX_H (3.2) and warns, naming the model', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const { root } = make_rig(8.209)
    const r = prepare_mob_render(root, { label: 'hy_dragon_fire' })
    expect(r.height).toBeCloseTo(3.2, 5)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('hy_dragon_fire')
    expect(warn.mock.calls[0][0]).toContain('clamped')
    warn.mockRestore()
  })

  test('MOB path — an undersized export (0.15 GLB units ⇒ 0.075, above the 0.05 degenerate guard) clamps UP to MOB_MIN_H (0.35) and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const { root } = make_rig(0.15)
    const r = prepare_mob_render(root, {})
    expect(r.height).toBeCloseTo(0.35, 5)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  test('MOB path — the smallest real critter (silk larva, 0.835 units ⇒ 0.42 blocks) sits ABOVE the floor: no clamp, no warn', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const { root } = make_rig(0.835)
    const r = prepare_mob_render(root, {})
    expect(r.height).toBeCloseTo(0.418, 2)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  test('kills metalness (the gold/black class) on every material', () => {
    const { root, mat } = make_rig(2)
    prepare_mob_render(root, { target_height: 1.4 })
    expect(mat.metalness).toBe(0)
  })

  test('pixel_filter:true (mob) ⇒ Nearest mag + aniso + albedo emissive floor', () => {
    const { root, map, mat } = make_rig(2)
    prepare_mob_render(root, { target_height: 1.4, pixel_filter: true })
    expect(map.magFilter).toBe(NearestFilter)
    expect(map.anisotropy).toBe(8)
    expect(mat.emissiveMap).toBe(map) // per-texel albedo floor, not a flat wash
    expect(mat.emissiveIntensity).toBeCloseTo(0.3, 5)
  })

  test('pixel_filter:false (player) ⇒ smooth Linear kept, NO emissive floor (players never route through the mob look)', () => {
    const { root, map, mat } = make_rig(2)
    prepare_mob_render(root, { target_height: 2, pixel_filter: false })
    expect(map.magFilter).not.toBe(NearestFilter)
    expect(/** @type {any} */ (mat).__mob_shade_floor).toBeUndefined()
  })

  test('shadow convention: cast on, receive OFF by default (mob), frustumCulled off (skinned bounds lie)', () => {
    const { root, mesh } = make_rig(2)
    prepare_mob_render(root, { target_height: 1.4 })
    expect(mesh.castShadow).toBe(true)
    expect(mesh.receiveShadow).toBe(false)
    expect(mesh.frustumCulled).toBe(false)
  })

  test('receive_shadow:true (the player caller) is honoured', () => {
    const { root, mesh } = make_rig(2)
    prepare_mob_render(root, { target_height: 2, receive_shadow: true })
    expect(mesh.receiveShadow).toBe(true)
  })

  test('a degenerate zero-height rig does not divide-by-zero (the 0.05 guard)', () => {
    const { root } = make_rig(0.001)
    expect(() => prepare_mob_render(root, { target_height: 1.4 })).not.toThrow()
  })
})
