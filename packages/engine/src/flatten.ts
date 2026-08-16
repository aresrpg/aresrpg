// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { uniform } from 'three/tsl'
import type { UniformNode } from 'three/webgpu'

const TRANSITION_SECONDS = 0.85

export type FlatProjection = Readonly<{ amount: number; target: 0 | 1 }>
export type FlattenUniform = Readonly<{
  amount: UniformNode<'float', number>
  set: (amount: number) => boolean
  flattened: () => boolean
}>

const clamp_amount = (amount: number): number => Math.min(1, Math.max(0, amount))

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
  source_y + (0 - source_y) * clamp_amount(flat_amount)

export const create_flatten_uniform = (): FlattenUniform => {
  const amount = uniform(0, 'float')
  return Object.freeze({
    amount,
    set: (next: number) => {
      const value = clamp_amount(next)
      if (amount.value === value) return false
      amount.value = value
      return true
    },
    flattened: () => amount.value >= 1,
  })
}
