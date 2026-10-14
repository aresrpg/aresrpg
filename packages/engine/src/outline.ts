// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// INK OUTLINES. A thin dark line marks every place where one surface hides what lies behind it:
// terrace rims seen from above, cliff and character silhouettes. Flat faces and visible creases
// stay clean, so the ground never turns into a per-block grid.
//
// The test runs on INVERSE view depth (1/z). A flat face is exactly linear in 1/z across the
// screen at any angle, so its second difference is zero — grazing ground draws nothing. A hidden
// drop breaks that line, and dividing by (1/z)² turns the break into its size in blocks, the same
// at every distance. Only the NEARER side of a break is inked, which keeps the line one pixel wide
// and puts it on the surface that does the hiding.

import type { Node } from 'three/webgpu'
import { float, mix, smoothstep, textureSize, uniform, vec2, vec4 } from 'three/tsl'

type DepthTexture = Node<'vec4'> & Readonly<{ sample: (uv: Node<'vec2'>) => Node<'vec4'> }>

/** Hidden drop, in blocks along the view axis, where the line starts and where it is full. */
const STEP_START = 0.3
const STEP_FULL = 0.6
/** View distance, in blocks, over which lines dissolve before fog and the far shell own the frame. */
const FADE_START = 70
const FADE_END = 150
/** Line width in CSS pixels, so every display density and render scale shows the same stroke. */
const LINE_WIDTH = 2
/** A full line keeps this share of the surface colour: a dark shade of itself, never flat black. */
const INK = 0.3

const smooth = (low: number, high: number, value: number): number => {
  const progress = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return progress * progress * (3 - 2 * progress)
}

/** CPU twin of the shader test over one pixel and its four neighbours, all as inverse view depth. */
export const outline_strength = ({
  centre,
  left,
  right,
  up,
  down,
}: Readonly<{ centre: number; left: number; right: number; up: number; down: number }>): number => {
  const nearer = Math.max(centre * 2 - left - right, centre * 2 - up - down)
  const step = nearer / Math.max(centre * centre, 1e-12)
  const fade = 1 - smooth(FADE_START, FADE_END, 1 / Math.max(centre, 1e-6))
  return smooth(STEP_START, STEP_FULL, step) * fade
}

/** Depth texels a line spans. Whole texels only — the depth buffer is point-sampled, and an uneven pair of taps reads a flat
 * face as bent. */
export const outline_width_texels = (texels_per_css_pixel: number): number =>
  Math.max(1, Math.round(texels_per_css_pixel * LINE_WIDTH))

export const create_outline = ({
  depth,
  projection_inverse,
}: Readonly<{ depth: DepthTexture; projection_inverse: Node<'mat4'> }>) => {
  // Unprojecting the raw depth through the scene camera follows whichever depth convention the
  // renderer chose; no near/far or reversed-depth branch is repeated here.
  const inverse_depth = (uv: Node<'vec2'>): Node<'float'> => {
    const view_point = projection_inverse.mul(vec4(0, 0, depth.sample(uv).r, 1))
    return view_point.w.div(view_point.z).negate() as unknown as Node<'float'>
  }
  const width = uniform(1)
  const texel = vec2(width).div(vec2(textureSize(depth) as unknown as Node<'ivec2'>))
  /** Darkens `color` along hidden drops; `uv` is the same coordinate the colour was sampled at. */
  const ink = (color: Node<'vec3'>, uv: Node<'vec2'>): Node<'vec3'> => {
    const centre = inverse_depth(uv)
    const pair = (x: number, y: number): Node<'float'> =>
      inverse_depth(uv.sub(texel.mul(vec2(x, y)))).add(inverse_depth(uv.add(texel.mul(vec2(x, y)))))
    const nearer = centre
      .mul(2)
      .sub(pair(1, 0))
      .max(centre.mul(2).sub(pair(0, 1)))
    const step = nearer.div(centre.mul(centre).max(1e-12))
    const fade = smoothstep(FADE_START, FADE_END, float(1).div(centre.max(1e-6))).oneMinus()
    const line = smoothstep(STEP_START, STEP_FULL, step).mul(fade)
    return color.mul(mix(float(1), float(INK), line)) as unknown as Node<'vec3'>
  }
  return Object.freeze({
    ink,
    set_pixel_density: (texels_per_css_pixel: number): void => {
      width.value = outline_width_texels(texels_per_css_pixel)
    },
  })
}
