// Reframe law regression (too tight and too high — needed to move the camera away, not zoom in):
// the head fit must frame the model's WHOLE measured bounding box centered at showcase distance — a
// position/dolly reframe, never a bust-crop zoom. Expectations are hand-derived from the documented
// level-camera model (worldY(py) = camy + R·TAN_HALF·(1 − 2py/canvas)); the T terms cancel out of every
// radius, so those constants are probe-geometry closed forms, not re-implementations of the fit.
import { describe, expect, test } from 'bun:test'

import { FILL, HEAD_PROBE, MIN_RADIUS, TAN_HALF, head_fit_params, within_margins } from './shop_head_autofit.mjs'

const CANVAS = 512

describe('head_fit_params — bbox reframe, not zoom', () => {
  test('centers the camera on the full measured box and dollies to fit it at FILL', () => {
    // bbox rows 64…447 are symmetric about the probe aim (1.8): spans +0.75…−0.75 of the half-frame.
    const fit = head_fit_params({ b: 447, l: 176, r: 335, t: 64 }, CANVAS)

    // Level camera aimed at the box center — the model sits centered, never hugging the frame top.
    expect(fit.camera_y).toBeCloseTo(1.8, 6)
    expect(fit.target_y).toBe(fit.camera_y)
    // radius_v = probe_R·(0.75 + 0.75)/(2·FILL) = 4·1.5/1.36 (TAN_HALF cancels).
    expect(fit.camera_radius).toBeCloseTo((4 * 1.5) / (2 * FILL), 6)
  })

  test('a taller hat moves the camera FARTHER away and aims higher (monotone reframe)', () => {
    const short_hat = head_fit_params({ b: 447, l: 176, r: 335, t: 64 }, CANVAS)
    const tall_hat = head_fit_params({ b: 447, l: 176, r: 335, t: 32 }, CANVAS)

    expect(tall_hat.camera_radius).toBeGreaterThan(short_hat.camera_radius)
    expect(tall_hat.camera_y).toBeGreaterThan(short_hat.camera_y)
  })

  test('short models floor at MIN_RADIUS — the face-crop dolly is impossible', () => {
    // rows 192…447 → radius_v = 4·1.0/1.36 ≈ 2.94 < MIN_RADIUS; narrow box keeps radius_h tiny.
    const fit = head_fit_params({ b: 447, l: 224, r: 287, t: 192 }, CANVAS)

    expect(fit.camera_radius).toBe(MIN_RADIUS)
    // Aim still centers the measured box: worldY midpoint of rows 192 and 448.
    const world_y = (py) => 1.8 + 4 * TAN_HALF * (1 - (2 * py) / CANVAS)
    expect(fit.camera_y).toBeCloseTo((world_y(192) + world_y(448)) / 2, 6)
  })

  test('a wide silhouette drives the dolly through the horizontal fit', () => {
    // 448 px wide → box_w = 448·(2·4·T/512) = 7T → radius_h = 4·(448/256)/(2·FILL) (T cancels).
    const fit = head_fit_params({ b: 447, l: 32, r: 479, t: 192 }, CANVAS)

    expect(fit.camera_radius).toBeCloseTo((4 * (448 / 256)) / (2 * FILL), 6)
  })

  test('the wide probe pass is honored as the default mapping frame', () => {
    const custom = head_fit_params({ b: 447, l: 176, r: 335, t: 64 }, CANVAS, HEAD_PROBE)
    const implicit = head_fit_params({ b: 447, l: 176, r: 335, t: 64 }, CANVAS)

    expect(custom).toEqual(implicit)
  })
})

describe('within_margins — every edge guarded (whole model visible)', () => {
  const m = Math.round(CANVAS * 0.04) // 20 px

  test('accepts a box comfortably inside the margins', () => {
    expect(within_margins({ b: CANVAS - m, l: m, r: CANVAS - m, t: m }, CANVAS)).toBe(true)
  })

  test('rejects clips on any edge — including the BOTTOM (feet are part of the reframe)', () => {
    expect(within_margins({ b: 400, l: 100, r: 400, t: 5 }, CANVAS)).toBe(false) // top clip
    expect(within_margins({ b: 505, l: 100, r: 400, t: 100 }, CANVAS)).toBe(false) // bottom clip (new law)
    expect(within_margins({ b: 400, l: 5, r: 400, t: 100 }, CANVAS)).toBe(false) // side clip
    expect(within_margins(null, CANVAS)).toBe(false) // blank render
  })
})
