// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Headless tests for the GPU cull's CPU-side frustum plane extraction (src/render/gpu_cull.js `run`).
// The cull kernel itself is a WebGPU compute pass (exercised on real Metal by the cube_planes +
// streaming bench gates), but run() extracts the 6 camera frustum planes on the CPU and uploads them —
// this is where the WebGPU reversed-Z regression lived (the "sky-only at horizontal pitch" defect):
// calling Frustum.setFromProjectionMatrix WITHOUT the camera's coordinateSystem + reversedDepth flags
// extracts a degenerate near/far pair from a reversed-Z projection. run() must pass both flags. These
// tests pin that (a proxy pool of meta/indirect attrs + a no-op-compute renderer stub — no GPU).

import { describe, expect, test } from 'bun:test'
import { Euler, Frustum, Matrix4, PerspectiveCamera, WebGPUCoordinateSystem } from 'three'

import { create_gpu_cull } from '../../src/render/gpu_cull.js'
import { create_quad_pool } from '../../src/render/quad_pool.js'

/** Camera in the exact state three's WebGPU renderer leaves it when `reversedDepthBuffer: true`. */
function make_reversed_z_webgpu_camera() {
  const camera = new PerspectiveCamera(70, 1280 / 800, 0.1, 20000)
  camera.coordinateSystem = WebGPUCoordinateSystem
  ;/** @type {{_reversedDepth: boolean}} */ (/** @type {unknown} */ (camera))._reversedDepth = true
  camera.updateProjectionMatrix()
  return camera
}

/** @param {PerspectiveCamera} camera @param {[number,number,number]} position @param {number} yaw @param {number} pitch */
function pose(camera, position, yaw, pitch) {
  camera.position.set(...position)
  camera.quaternion.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'))
  camera.updateMatrixWorld(true)
}

/** A gpu_cull wired to a throwaway pool's attrs, plus a renderer stub whose compute() is a no-op spy. */
function make_cull() {
  const pool = create_quad_pool({ slot_quads: 2048, max_slots: 8 })
  const cull = create_gpu_cull({
    meta_attr: pool.meta_attr,
    indirect_attr: pool.indirect_attr,
    slot_quads: 2048,
    max_slots: 8,
    chunk_size: 32,
  })
  let compute_calls = 0
  const renderer = /** @type {any} */ ({
    compute: () => {
      compute_calls += 1
    },
  })
  return { cull, renderer, compute_calls: () => compute_calls }
}

/** Reads the k-th extracted plane [nx, ny, nz, constant] from the cull's planes buffer.
 * @param {ReturnType<typeof create_gpu_cull>} cull @param {number} k @returns {number[]} */
function plane(cull, k) {
  const a = /** @type {Float32Array} */ (cull.planes_attr.array)
  return [a[k * 4], a[k * 4 + 1], a[k * 4 + 2], a[k * 4 + 3]]
}

/** Signed distance of a point to a plane (inward normal ⇒ ≥0 means inside the frustum).
 * @param {number[]} p [nx, ny, nz, constant] @param {number[]} q [x, y, z] */
function distance(p, q) {
  return p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3]
}

describe('gpu_cull.run — reversed-Z frustum plane extraction', () => {
  test('dispatches the compute pass once and fills all 6 planes with unit normals', () => {
    const { cull, renderer, compute_calls } = make_cull()
    const camera = make_reversed_z_webgpu_camera()
    pose(camera, [0, 140, 0], 0, 0)
    cull.run(renderer, camera)
    expect(compute_calls()).toBe(1)
    for (let k = 0; k < 6; k += 1) {
      const [nx, ny, nz] = plane(cull, k)
      const len = Math.hypot(nx, ny, nz)
      expect(len).toBeGreaterThan(0.5) // no degenerate/zero plane (the reversed-Z bug produced these)
    }
  })

  test('extracted planes EXACTLY match a reversed-Z-aware reference frustum (flags honored)', () => {
    const { cull, renderer } = make_cull()
    const camera = make_reversed_z_webgpu_camera()
    pose(camera, [0, 140, 0], 0, 0)
    cull.run(renderer, camera)

    const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const ref = new Frustum().setFromProjectionMatrix(
      vp,
      /** @type {*} */ (camera).coordinateSystem,
      /** @type {*} */ (camera).reversedDepth
    )
    for (let k = 0; k < 6; k += 1) {
      const [nx, ny, nz, c] = plane(cull, k)
      expect(nx).toBeCloseTo(ref.planes[k].normal.x, 5)
      expect(ny).toBeCloseTo(ref.planes[k].normal.y, 5)
      expect(nz).toBeCloseTo(ref.planes[k].normal.z, 5)
      expect(c).toBeCloseTo(ref.planes[k].constant, 5)
    }
  })

  test('the reversed-Z flags MATTER: extraction differs from the 1-arg (buggy) form', () => {
    // The original defect: the 1-arg setFromProjectionMatrix assumes WebGL/[-1,1]/non-reversed and
    // extracts a degenerate near/far from a reversed-Z projection. Proving run()'s planes differ from
    // that form guards against a regression back to the flag-less call.
    const { cull, renderer } = make_cull()
    const camera = make_reversed_z_webgpu_camera()
    pose(camera, [0, 140, 0], 0, 0)
    cull.run(renderer, camera)
    const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const buggy = new Frustum().setFromProjectionMatrix(vp) // 1-arg WebGL default — the bug
    let any_diff = false
    for (let k = 0; k < 6 && !any_diff; k += 1) {
      const [nx, ny, nz, c] = plane(cull, k)
      if (
        Math.abs(nx - buggy.planes[k].normal.x) > 1e-4 ||
        Math.abs(ny - buggy.planes[k].normal.y) > 1e-4 ||
        Math.abs(nz - buggy.planes[k].normal.z) > 1e-4 ||
        Math.abs(c - buggy.planes[k].constant) > 1e-4
      ) {
        any_diff = true
      }
    }
    expect(any_diff).toBe(true)
  })

  test('a chunk ahead within view distance is inside all planes; one behind the camera is not', () => {
    // Behavioral check that the frustum is correctly oriented + the far plane is non-degenerate at the
    // 20km far distance (the exact case the reversed-Z bug broke — a lost far plane over-includes; a
    // degenerate near/far would wrongly reject the point ahead).
    const { cull, renderer } = make_cull()
    const camera = make_reversed_z_webgpu_camera()
    pose(camera, [0, 140, 0], 0, 0) // looking down −z
    cull.run(renderer, camera)
    const planes = [0, 1, 2, 3, 4, 5].map((k) => plane(cull, k))

    const ahead = /** @type {[number,number,number]} */ ([0, 135, -100]) // 100m ahead, slightly below
    const far_ahead = /** @type {[number,number,number]} */ ([0, 140, -18000]) // 18km ahead (< 20km far)
    const behind = /** @type {[number,number,number]} */ ([0, 140, 100]) // behind the camera

    expect(planes.every((p) => distance(p, ahead) >= 0)).toBe(true)
    expect(planes.every((p) => distance(p, far_ahead) >= 0)).toBe(true) // far plane not degenerate
    expect(planes.every((p) => distance(p, behind) >= 0)).toBe(false) // near/behind plane rejects it
  })
})
