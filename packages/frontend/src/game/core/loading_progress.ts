// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldState } from './world.ts'

export type WorldLoadingSource = Readonly<{ state: () => WorldState }>
export type LoadingProgress = Readonly<{
  stage: 'assets' | 'graphics' | 'terrain' | 'sky' | 'finishing' | 'failed' | 'ready'
  fraction: number | null
}>

/** Progress describes observed work. Shader compilation has no exposed completion counter. */
export const loading_progress = (state: WorldState | null): LoadingProgress => {
  if (!state) return { stage: 'assets', fraction: null }
  if (state.engine.state === 'failed') return { stage: 'failed', fraction: null }
  if (state.engine.state === 'initializing') return { stage: 'graphics', fraction: null }
  const { chunks, render } = state
  if (chunks.planning > 0) return { stage: 'terrain', fraction: null }
  if (chunks.queued + chunks.in_flight + chunks.evicting > 0)
    return { stage: 'terrain', fraction: chunks.total > 0 ? chunks.ready / chunks.total : null }
  if (!render.sky_ready || !render.far_ready) return { stage: 'sky', fraction: null }
  return { stage: render.settled && chunks.resident > 0 ? 'ready' : 'finishing', fraction: null }
}

/** Completed preparation phases, not an estimate of elapsed time or driver compilation percentage. */
export const loading_phase = (stage: LoadingProgress['stage']): number => {
  switch (stage) {
    case 'assets':
      return 0
    case 'graphics':
      return 1
    case 'terrain':
      return 2
    case 'sky':
    case 'finishing':
    case 'failed':
      return 3
    case 'ready':
      return 4
  }
}
