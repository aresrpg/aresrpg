// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineStatus } from '@aresrpg/engine'

export type EngineInput =
  | Readonly<{ type: 'engine/canvas_attached'; canvas: HTMLCanvasElement }>
  | Readonly<{ type: 'engine/canvas_detached'; canvas: HTMLCanvasElement }>
  | Readonly<{ type: 'engine/status'; status: EngineStatus }>

export type EngineState = EngineStatus & Readonly<{ recovery: 'none' | 'minimum' | 'grid' }>

export const initial_engine_state = (): EngineState => ({ state: 'initializing', backend: 'none', recovery: 'none' })

export const next_engine_recovery = (current: EngineState, status: EngineStatus): EngineState['recovery'] => {
  if (status.state !== 'failed' || status.issue?.code === 'world_unavailable' || status.backend === 'grid')
    return current.recovery
  return current.recovery === 'none' ? 'minimum' : 'grid'
}

export const receive_engine_status = (current: EngineState, status: EngineStatus): EngineState => {
  const recovery = next_engine_recovery(current, status)
  return Object.freeze({
    ...status,
    ...(recovery !== current.recovery ? { state: 'initializing' as const, backend: 'none' as const } : {}),
    recovery,
  })
}
