// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The flat-world burn (owner 2026-08-15 re-tune): terrain KEEPS ITS COLORS on the plane — the
// retro grid is a faint overlay, not a palette swap. The burn front is color-only; the shared
// projection amount moves geometry so every CPU and GPU consumer agrees on world height.

import type { Node } from 'three/webgpu'
import { abs, color, float, fract, max, mix, sin, smoothstep } from 'three/tsl'

import { HACK_LATTICE, HACK_PALETTE } from './hack_palette.ts'

type ScalarNode = Node<'float'>
type ColorNode = Node<'vec3'>

const grid_line = (x: ScalarNode, z: ScalarNode, spacing: number, from: number): Node<'float'> =>
  max(
    smoothstep(float(from), float(0.5), abs(fract(x.div(spacing)).sub(0.5))),
    smoothstep(float(from), float(0.5), abs(fract(z.div(spacing)).sub(0.5)))
  )

export const create_flat_nodes = (
  x: ScalarNode,
  z: ScalarNode,
  amount: ScalarNode,
  base_color: ColorNode
): Readonly<{ burn: Node<'float'>; burn_edge: Node<'float'>; color: Node<'vec3'> }> => {
  // A continuous world-space field owns the transition. The former key used each greedy quad's
  // origin, which made an entire merged face flash as one large rectangle during the burn.
  const qx = x.mul(0.031).add(sin(z.mul(0.017)).mul(1.35))
  const qz = z.mul(0.027).add(sin(x.mul(0.013)).mul(1.1))
  const noise = sin(qx)
    .mul(0.45)
    .add(sin(qz).mul(0.35))
    .add(sin(qx.add(qz).mul(1.7)).mul(0.2))
    .mul(0.5)
    .add(0.5)
  const front = mix(float(-0.08), float(1.08), amount)
  const burn = smoothstep(noise.sub(0.08), noise.add(0.08), front)
  const burn_edge = float(1).sub(smoothstep(float(0), float(0.065), abs(front.sub(noise))))
  const minor = grid_line(x, z, HACK_LATTICE.minor_m, 0.46)
  const major = grid_line(x, z, HACK_LATTICE.major_m, 0.48)
  const grid_glow = color(HACK_PALETTE.grid_minor)
    .mul(minor)
    .mul(0.22)
    .add(color(HACK_PALETTE.grid_major).mul(major).mul(0.35))
  return Object.freeze({
    burn,
    burn_edge,
    // Terrain colors survive the flatten; the lattice is a faint additive overlay and the burn
    // edge keeps a mild glow while a slab is in flight.
    color: base_color.add(grid_glow.mul(amount)).add(color(HACK_PALETTE.grid_minor).mul(burn_edge).mul(0.22)),
  })
}

/** CPU twin of the shader field. It pins the continuous world-space law used by the transition. */
export const flat_burn_field = (x: number, z: number): number => {
  const qx = x * 0.031 + Math.sin(z * 0.017) * 1.35
  const qz = z * 0.027 + Math.sin(x * 0.013) * 1.1
  const field = (Math.sin(qx) * 0.45 + Math.sin(qz) * 0.35 + Math.sin((qx + qz) * 1.7) * 0.2) * 0.5 + 0.5
  return Math.min(1, Math.max(0, field))
}
