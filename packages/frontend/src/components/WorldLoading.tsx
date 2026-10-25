// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EngineQuality, EngineStatus } from '@aresrpg/engine'

import { finish_startup_recovery, recover_missing_asset } from '../startup_recovery.ts'
import { useAppStore } from '../store.ts'
import {
  loading_progress,
  loading_phase,
  type LoadingProgress,
  type WorldLoadingSource,
} from '../game/core/loading_progress.ts'

import { LoadingPostcard } from './LoadingPostcard.tsx'
import { loading_wordmark, type LoadingContext } from './loading_art.ts'
import { useLoadingArtwork } from './useLoadingArtwork.ts'

import './world_loading.css'

type Presentation = Readonly<{
  identity: object
  progress: LoadingProgress
  phase: number
  fraction: number | null
  dismissed: boolean
}>
type Input =
  | Readonly<{ type: 'reset'; identity: object }>
  | Readonly<{ type: 'sample'; identity: object; progress: LoadingProgress }>
  | Readonly<{ type: 'dismiss'; identity: object }>
const always_ready = () => true
const initial = (identity: object): Presentation => ({
  identity,
  progress: { stage: 'assets', fraction: null },
  phase: 0,
  fraction: null,
  dismissed: false,
})
const reduce = (current: Presentation, input: Input): Presentation => {
  if (input.type === 'reset') return input.identity === current.identity ? current : initial(input.identity)
  if (input.identity !== current.identity) return current
  if (input.type === 'dismiss') return { ...current, dismissed: true }
  const phase = Math.max(current.phase, loading_phase(input.progress.stage))
  const fraction =
    input.progress.fraction === null
      ? null
      : Math.max(phase === current.phase ? (current.fraction ?? 0) : 0, input.progress.fraction)
  return { ...current, progress: input.progress, phase, fraction }
}

/** One opaque postcard lifetime; observed readiness ends loading, never a simulated timer. */
export const WorldLoading = ({
  source,
  quality,
  render_distance = null,
  failed = false,
  assets_ready,
  on_progress,
  context = 'world',
}: Readonly<{
  source: WorldLoadingSource | null
  quality: EngineQuality
  render_distance?: number | null
  failed?: boolean
  assets_ready?: () => boolean
  on_progress?: (progress: LoadingProgress, engine: EngineStatus) => void
  context?: LoadingContext
}>) => {
  const copy = useAppStore((state) => state.copy)
  const identity = useMemo(
    () => ({ source, quality, render_distance, context }),
    [source, quality, render_distance, context]
  )
  const is_assets_ready = assets_ready ?? always_ready
  const [retained, dispatch] = useReducer(reduce, identity, initial)
  const view = retained.identity === identity ? retained : initial(identity)
  const [tip, set_tip] = useState(0)
  const modal = useRef<HTMLDialogElement>(null)
  const active = !view.dismissed
  const art = useLoadingArtwork(context, active)
  useLayoutEffect(() => {
    const dialog = modal.current
    if (!dialog || !active) return
    dialog.showModal()
    return () => dialog.close()
  }, [active, copy])
  useEffect(() => {
    if (!active) return
    dispatch({ type: 'reset', identity })
    let live = true
    let timer = 0
    let frame = 0
    const sample = (): void => {
      if (!live) return
      const state = source?.state()
      const progress = failed ? { stage: 'failed' as const, fraction: null } : loading_progress(state ?? null)
      const next: LoadingProgress =
        progress.stage === 'ready' && !is_assets_ready() ? { stage: 'finishing', fraction: null } : progress
      dispatch({ type: 'sample', identity, progress: next })
      if (state) {
        on_progress?.(next, state.engine)
        recover_missing_asset(state.engine)
      }
      if (next.stage === 'ready') {
        finish_startup_recovery()
        timer = window.setTimeout(
          () => dispatch({ type: 'dismiss', identity }),
          matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300
        )
      } else if (next.stage !== 'failed') timer = window.setTimeout(sample, 100)
    }
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(sample)
    })
    return () => {
      live = false
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [source, identity, failed, is_assets_ready, on_progress, active])
  useEffect(() => {
    if (!active || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => set_tip((current) => (current + 1) % 4), 8000)
    return () => clearInterval(timer)
  }, [active])
  if (!copy || !active) return null
  return createPortal(
    <dialog
      ref={modal}
      className="loading-modal"
      aria-label={copy.loading_screen.eyebrow}
      onCancel={(event) => event.preventDefault()}
    >
      <LoadingPostcard
        copy={copy}
        context={context}
        {...art}
        wordmark={loading_wordmark}
        progress={failed ? { stage: 'failed', fraction: null } : view.progress}
        phase={view.phase}
        fraction={view.fraction}
        tip={tip}
        previous_tip={() => set_tip((current) => (current + 3) % 4)}
        next_tip={() => set_tip((current) => (current + 1) % 4)}
        reload={() => location.reload()}
      />
    </dialog>,
    document.body
  )
}
