// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineStatus } from '@aresrpg/engine'

export type FrameRateInput = Readonly<{
  type: 'engine/frames'
  source: string
  sample: Readonly<{ frames: number; elapsed_ms: number }> | null
}>

export type EngineInput =
  | FrameRateInput
  | Readonly<{ type: 'engine/jump'; down: boolean }>
  | Readonly<{ type: 'engine/movement'; forward: number; strafe: number }>
  | Readonly<{ type: 'engine/canvas_attached'; canvas: HTMLCanvasElement }>
  | Readonly<{ type: 'engine/canvas_detached'; canvas: HTMLCanvasElement }>
  | Readonly<{ type: 'engine/status'; status: EngineStatus }>

export type EngineState = EngineStatus &
  Readonly<{
    recovery: 'none' | 'minimum'
    frame_rate: Readonly<{ source: string; fps: number }> | null
  }>

export const initial_engine_state = (): EngineState => ({
  state: 'initializing',
  backend: 'none',
  recovery: 'none',
  frame_rate: null,
})

export const next_engine_recovery = (current: EngineState, status: EngineStatus): EngineState['recovery'] => {
  if (
    status.state !== 'failed' ||
    ['world_unavailable', 'webgpu_unavailable', 'renderer_load_failed', 'asset_missing'].includes(
      String(status.issue?.code)
    )
  )
    return current.recovery
  return 'minimum'
}

export const receive_engine_status = (current: EngineState, status: EngineStatus): EngineState => {
  const recovery = next_engine_recovery(current, status)
  return Object.freeze({
    ...status,
    frame_rate: current.frame_rate,
    ...(recovery !== current.recovery ? { state: 'initializing' as const, backend: 'none' as const } : {}),
    recovery,
  })
}

/** An idle or retired scene cannot overwrite the currently rendering scene's measurement. */
export const receive_frame_rate = (current: EngineState, { source, sample }: FrameRateInput): EngineState => {
  if ((!sample || sample.frames === 0) && current.frame_rate?.source !== source) return current
  const frame_rate = sample
    ? { source, fps: Math.round((sample.frames * 1000) / Math.max(1, sample.elapsed_ms)) }
    : null
  return { ...current, frame_rate }
}
