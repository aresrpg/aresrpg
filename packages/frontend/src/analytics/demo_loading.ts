// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineIssue } from '@aresrpg/engine'

import type { AnalyticsCapture, AnalyticsEvent } from '../analytics.ts'
import type { LoadingProgress } from '../game/core/loading_progress.ts'

type Point = readonly [number, number]
type LoadState = Readonly<{
  phase: 'loading' | 'playable' | 'moved' | 'failed'
  playable_at: number
  origin: Point | null
}>
export type DemoLoadSample = Readonly<{
  stage: LoadingProgress['stage'] | 'movement'
  elapsed_ms: number
  position: Point | null
  failure_stage?: EngineIssue['code'] | 'graphics' | 'character'
}>

const movement = (state: LoadState, sample: DemoLoadSample) => {
  if (!sample.position) return { state, events: [] }
  if (!state.origin) return { state: { ...state, origin: sample.position }, events: [] }
  const distance = Math.hypot(sample.position[0] - state.origin[0], sample.position[1] - state.origin[1])
  return distance < 0.25
    ? { state, events: [] }
    : {
        state: { ...state, phase: 'moved' as const },
        events: [
          {
            name: 'demo_first_movement',
            properties: { duration_ms: Math.round(sample.elapsed_ms - state.playable_at) },
          },
        ],
      }
}

const advance = (
  state: LoadState,
  sample: DemoLoadSample
): Readonly<{ state: LoadState; events: readonly AnalyticsEvent[] }> => {
  if (state.phase === 'moved' || state.phase === 'failed') return { state, events: [] }
  if (state.phase === 'playable') return sample.stage === 'movement' ? movement(state, sample) : { state, events: [] }
  if (sample.stage === 'failed')
    return {
      state: { ...state, phase: 'failed' },
      events: [
        {
          name: 'demo_load_failed',
          properties: {
            duration_ms: Math.round(sample.elapsed_ms),
            stage: sample.failure_stage ?? 'graphics',
          },
        },
      ],
    }
  if (sample.stage === 'ready')
    return {
      state: { ...state, phase: 'playable', playable_at: sample.elapsed_ms, origin: sample.position },
      events: [{ name: 'demo_playable', properties: { duration_ms: Math.round(sample.elapsed_ms) } }],
    }
  return { state, events: [] }
}

/** One page-lifetime fold; repeated loading samples and StrictMode effects cannot replay milestones. */
export const create_demo_loading_observer = (capture: AnalyticsCapture) => {
  let state: LoadState = { phase: 'loading', playable_at: 0, origin: null }
  return {
    playable: (): boolean => state.phase === 'playable' || state.phase === 'moved',
    observe: (sample: DemoLoadSample): boolean => {
      const next = advance(state, sample)
      ;({ state } = next)
      next.events.forEach(({ name, properties }) => capture(name, properties))
      return state.phase === 'moved' || state.phase === 'failed'
    },
  }
}
