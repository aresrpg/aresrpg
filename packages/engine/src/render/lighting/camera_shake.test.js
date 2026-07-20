import { test, expect } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'

import { create_camera_shake, shake_envelope, SHAKE_DURATION, SHAKE_PEAK_FRAC } from './camera_shake.js'

// [D248] the impact-shake envelope: fast attack to a peak at ~11%, long ease-out to zero by the end.
test('shake_envelope: 0 at the ends, exactly 1 at the peak fraction', () => {
  expect(shake_envelope(0)).toBe(0)
  expect(shake_envelope(1)).toBe(0)
  expect(shake_envelope(-0.5)).toBe(0)
  expect(shake_envelope(SHAKE_PEAK_FRAC)).toBeCloseTo(1, 6) // (u/p)·e^(1−u/p) = 1 at u=p
})

test('shake_envelope: rises to the peak then decays (fast in, slow out)', () => {
  const pre = shake_envelope(SHAKE_PEAK_FRAC / 2)
  const peak = shake_envelope(SHAKE_PEAK_FRAC)
  const post = shake_envelope(SHAKE_PEAK_FRAC * 4)
  expect(pre).toBeLessThan(peak)
  expect(post).toBeLessThan(peak)
  expect(post).toBeGreaterThan(0) // still decaying, not yet zero
  // fast attack / slow decay: at equal distance either side of the peak, the DECAY side is higher.
  const d = SHAKE_PEAK_FRAC * 0.5
  expect(shake_envelope(SHAKE_PEAK_FRAC + d)).toBeGreaterThan(shake_envelope(SHAKE_PEAK_FRAC - d))
})

test('driver: idle by default, offsets the camera mid-shake, restores exactly (non-accumulating)', () => {
  const cam = new PerspectiveCamera()
  cam.position.set(10, 5, 10)
  cam.updateMatrixWorld()
  const base = cam.position.clone()
  const shake = create_camera_shake()

  expect(shake.active).toBe(false)
  expect(shake.apply(cam, 0.016)).toBeNull() // idle → nothing offset

  shake.trigger(0.2)
  expect(shake.active).toBe(true)
  // step to ~the peak (0.108 * 0.6 ≈ 0.065 s)
  const restore = shake.apply(cam, SHAKE_PEAK_FRAC * SHAKE_DURATION)
  expect(restore).not.toBeNull()
  expect(cam.position.distanceTo(base)).toBeGreaterThan(0.02) // genuinely displaced
  restore?.()
  expect(cam.position.distanceTo(base)).toBe(0) // restored EXACTLY — never drifts the rig
})

test('driver: goes idle after the duration and stops offsetting', () => {
  const cam = new PerspectiveCamera()
  const base = cam.position.clone()
  const shake = create_camera_shake()
  shake.trigger(0.5)
  shake.apply(cam, SHAKE_DURATION + 0.01)?.() // step past the end
  expect(shake.active).toBe(false)
  expect(shake.apply(cam, 0.016)).toBeNull()
  expect(cam.position.equals(base)).toBe(true)
})

test('driver: a re-trigger never shortens a stronger in-flight shake', () => {
  const cam = new PerspectiveCamera()
  const shake = create_camera_shake()
  shake.trigger(0.5) // crit
  shake.apply(cam, 0.2)?.() // partway through
  shake.trigger(0.1) // a chip hit lands — must NOT reset the crit to a weak short shake
  // still in the ORIGINAL crit's timeline (didn't reset t to 0 with amp 0.1)
  expect(shake.active).toBe(true)
})
