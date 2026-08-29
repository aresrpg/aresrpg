// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { uniform } from 'three/tsl'
import type { UniformNode } from 'three/webgpu'

const TRANSITION_SECONDS = 0.85
const WATER_EXIT_END = 0.2

export type FlatProjection = Readonly<{ amount: number; target: 0 | 1 }>
export type RenderBackend = 'none' | 'initializing' | 'webgpu' | 'grid'
export type FlattenUniform = Readonly<{
  amount: UniformNode<'float', number>
  water_visibility: UniformNode<'float', number>
  set: (amount: number) => boolean
  flattened: () => boolean
}>

const clamp_amount = (amount: number): number => Math.min(1, Math.max(0, amount))

export const effective_flattened = (requested: boolean, backend: RenderBackend): boolean =>
  requested || backend === 'grid'

export const flat_terrain_amount = (progress: number): number =>
  clamp_amount((clamp_amount(progress) - WATER_EXIT_END) / (1 - WATER_EXIT_END))

export const flat_water_visibility = (progress: number): number => {
  const amount = clamp_amount(clamp_amount(progress) / WATER_EXIT_END)
  return 1 - amount * amount * (3 - 2 * amount)
}

export const create_flat_projection = (flattened = false): FlatProjection =>
  Object.freeze({ amount: flattened ? 1 : 0, target: flattened ? 1 : 0 })

export const set_flat_projection = (state: FlatProjection, flattened: boolean): FlatProjection =>
  Object.freeze({ amount: state.amount, target: flattened ? 1 : 0 })

export const step_flat_projection = (state: FlatProjection, delta_seconds: number): FlatProjection => {
  const difference = state.target - state.amount
  if (Math.abs(difference) < 0.001) return Object.freeze({ amount: state.target, target: state.target })
  const step = Math.min(Math.abs(difference), Math.max(0, delta_seconds) / TRANSITION_SECONDS)
  return Object.freeze({ amount: clamp_amount(state.amount + Math.sign(difference) * step), target: state.target })
}

export const project_height = (source_y: number, flat_amount: number): number =>
  source_y + (0 - source_y) * flat_terrain_amount(flat_amount)

export const create_flatten_uniform = (): FlattenUniform => {
  const amount = uniform(0, 'float')
  const water_visibility = uniform(1, 'float')
  let progress = 0
  return Object.freeze({
    amount,
    water_visibility,
    set: (next: number) => {
      const value = clamp_amount(next)
      if (progress === value) return false
      progress = value
      amount.value = flat_terrain_amount(value)
      water_visibility.value = flat_water_visibility(value)
      return true
    },
    flattened: () => amount.value >= 1,
  })
}
