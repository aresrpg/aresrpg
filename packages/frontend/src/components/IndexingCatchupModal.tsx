// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { LinkStatus } from '../modules/session.ts'

export const PLAYABLE_INDEXING_LAG = 300
const SAMPLE_LIMIT = 12
const SAMPLE_STALE_MS = 10_000

type IndexingSample = Readonly<{ at_ms: number; lag: number }>
export type IndexingCatchup = Readonly<{
  started_lag: number
  best_lag: number
  samples: readonly IndexingSample[]
}>

export const indexing_blocked = (status: LinkStatus, lag: number | null): boolean =>
  (status === 'connected' || status === 'ready') && (lag === null || lag > PLAYABLE_INDEXING_LAG)

export const advance_indexing_catchup = (
  current: IndexingCatchup | null,
  lag: number,
  at_ms: number
): IndexingCatchup => {
  const started_lag = current?.started_lag ?? Math.max(lag, PLAYABLE_INDEXING_LAG + 1)
  const best_lag = Math.min(current?.best_lag ?? lag, lag)
  const samples = [...(current?.samples ?? []), Object.freeze({ at_ms, lag })].slice(-SAMPLE_LIMIT)
  return Object.freeze({ started_lag, best_lag, samples: Object.freeze(samples) })
}

export const project_indexing_catchup = (
  catchup: IndexingCatchup,
  now_ms: number
): Readonly<{ progress_percent: number; remaining: number; eta_seconds: number | null }> => {
  const latest = catchup.samples.at(-1)!
  const oldest = catchup.samples[0]!
  const total = Math.max(1, catchup.started_lag - PLAYABLE_INDEXING_LAG)
  const completed = Math.max(0, catchup.started_lag - catchup.best_lag)
  const progress_percent = Math.min(100, Math.round((completed * 100) / total))
  const remaining = Math.max(0, latest.lag - PLAYABLE_INDEXING_LAG)
  const elapsed_seconds = (latest.at_ms - oldest.at_ms) / 1_000
  const indexed = oldest.lag - latest.lag
  const rate = elapsed_seconds > 0 && indexed > 0 ? indexed / elapsed_seconds : null
  const elapsed_since_sample = Math.max(0, (now_ms - latest.at_ms) / 1_000)
  const eta_seconds =
    rate === null || now_ms - latest.at_ms > SAMPLE_STALE_MS
      ? null
      : Math.max(0, Math.ceil(remaining / rate - elapsed_since_sample))
  return Object.freeze({ progress_percent, remaining, eta_seconds })
}

const indexing_catchup_view = (
  catchup: IndexingCatchup | null,
  indexing_lag: number | null,
  now_ms: number
): Readonly<{ progress_percent: number; remaining: number | null; eta_seconds: number | null }> => {
  if (catchup) return project_indexing_catchup(catchup, now_ms)
  return Object.freeze({
    progress_percent: 0,
    remaining: indexing_lag === null ? null : Math.max(0, indexing_lag - PLAYABLE_INDEXING_LAG),
    eta_seconds: null,
  })
}

const duration_clock = (seconds: number): string => {
  const whole = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(whole / 3_600)
  const minutes = Math.floor((whole % 3_600) / 60)
  const remainder = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

export const IndexingCatchupModal = ({
  copy,
  indexing_lag,
}: Readonly<{ copy: AppCopy; indexing_lag: number | null }>) => {
  const [catchup, set_catchup] = useState<IndexingCatchup | null>(null)
  const [now_ms, set_now_ms] = useState(Date.now())

  useEffect(() => {
    if (indexing_lag === null) return
    const sampled_at = Date.now()
    set_now_ms(sampled_at)
    set_catchup((current) => advance_indexing_catchup(current, indexing_lag, sampled_at))
  }, [indexing_lag])

  useEffect(() => {
    const timer = setInterval(() => set_now_ms(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const view = indexing_catchup_view(catchup, indexing_lag, now_ms)
  const eta = view.eta_seconds === null ? null : duration_clock(view.eta_seconds)

  return (
    <section
      aria-labelledby="indexing-catchup-title"
      aria-modal="true"
      className="fixed inset-0 z-[190] grid place-items-center bg-bg/92 p-5 backdrop-blur-xl"
      data-indexing-blocker=""
      role="alertdialog"
    >
      <div className="w-full max-w-lg border border-[#4a9eff]/35 bg-surface p-7 shadow-[0_0_80px_rgba(74,158,255,0.14)]">
        <p className="text-[8px] tracking-[0.24em] text-[#67adff] uppercase">{copy.indexing_health}</p>
        <h2 id="indexing-catchup-title" className="mt-3 text-base font-semibold text-[#e8e4dc]">
          {copy.indexing_block_title}
        </h2>
        <p className="mt-3 text-[11px] leading-6 text-[#989da8]">{copy.indexing_block_body}</p>

        <div className="mt-6 h-2 overflow-hidden border border-white/8 bg-black/30">
          <div
            className="h-full bg-gradient-to-r from-[#4a9eff] to-[#55d6e8] transition-[width] duration-700"
            style={{ width: `${view.progress_percent}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-4 text-[9px] tracking-[0.12em] uppercase">
          <span className="text-[#68707d]">{copy.indexing_block_progress}</span>
          <span className="font-semibold text-[#67adff] tabular-nums">{view.progress_percent}%</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/7 pt-4">
          <div>
            <span className="block text-[7px] tracking-[0.15em] text-[#68707d] uppercase">
              {copy.indexing_block_remaining}
            </span>
            <span className="mt-1 block text-sm font-semibold text-[#e8e4dc] tabular-nums">
              {view.remaining ?? '—'}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[7px] tracking-[0.15em] text-[#68707d] uppercase">
              {copy.indexing_block_eta}
            </span>
            <span className="mt-1 block text-sm font-semibold text-[#e8e4dc] tabular-nums">
              {eta ?? copy.indexing_block_estimating}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export const SessionIndexingCatchup = ({
  copy,
  indexing_lag,
  status,
}: Readonly<{ copy: AppCopy; indexing_lag: number | null; status: LinkStatus }>) =>
  indexing_blocked(status, indexing_lag) ? <IndexingCatchupModal copy={copy} indexing_lag={indexing_lag} /> : null
