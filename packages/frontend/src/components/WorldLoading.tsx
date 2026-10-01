// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer } from 'react'
import type { EngineQuality, EngineStatus } from '@aresrpg/engine'

import { useAppStore } from '../store.ts'
import { loading_progress, type LoadingProgress, type WorldLoadingSource } from '../game/core/loading_progress.ts'

import './world_loading.css'

const reduce_progress = (current: LoadingProgress, next: LoadingProgress): LoadingProgress =>
  current.stage === next.stage && current.fraction === next.fraction ? current : next

/** A bounded startup/quality observer, never an overlay for ordinary movement streaming. */
export const WorldLoading = ({
  source,
  quality,
  render_distance = null,
  failed = false,
  assets_ready,
  on_progress,
}: Readonly<{
  source: WorldLoadingSource | null
  quality: EngineQuality
  render_distance?: number | null
  failed?: boolean
  assets_ready?: () => boolean
  on_progress?: (progress: LoadingProgress, engine: EngineStatus) => void
}>) => {
  const copy = useAppStore((state) => state.copy)
  const [progress, dispatch] = useReducer(reduce_progress, { stage: 'assets', fraction: null })
  useEffect(() => {
    dispatch({ stage: source ? 'graphics' : 'assets', fraction: null })
    if (!source) return
    let timer = 0
    let frame = 0
    const sample = () => {
      const state = source.state()
      const progress: LoadingProgress = failed ? { stage: 'failed', fraction: null } : loading_progress(state)
      const next: LoadingProgress =
        progress.stage === 'ready' && assets_ready?.() === false ? { stage: 'assets', fraction: null } : progress
      dispatch(next)
      on_progress?.(next, state.engine)
      if (next.stage !== 'ready' && next.stage !== 'failed') timer = window.setTimeout(sample, 100)
    }
    // Let the requested tier reach the existing world lifecycle before testing its queues.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(sample)
    })
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [source, quality, render_distance, failed, assets_ready, on_progress])
  if (!copy || (!failed && progress.stage === 'ready')) return null
  const stage = failed ? 'failed' : progress.stage
  const labels = {
    assets: copy.world_loading_assets,
    graphics: copy.world_loading_graphics,
    terrain: copy.world_loading_terrain,
    sky: copy.world_loading_sky,
    finishing: copy.world_loading_finishing,
    failed: copy.engine_recovery,
    ready: '',
  }
  return (
    <div className="world-loading" data-world-loading={stage}>
      <div className="world-loading-content" role="status" aria-live="polite">
        <span className="world-loading-mark" aria-hidden="true">
          ◇
        </span>
        <p>{labels[stage]}</p>
        {stage === 'failed' ? (
          <button type="button" onClick={() => location.reload()}>
            {copy.engine_reload}
          </button>
        ) : (
          <div
            className="world-loading-track"
            role="progressbar"
            aria-label={labels[stage]}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.fraction === null ? undefined : Math.round(progress.fraction * 100)}
          >
            <span
              data-indeterminate={progress.fraction === null}
              style={{ width: progress.fraction === null ? '32%' : `${Math.max(2, progress.fraction * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
