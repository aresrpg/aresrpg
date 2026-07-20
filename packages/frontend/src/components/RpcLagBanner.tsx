// App-global chain-freshness chip. Checkpoint lag uses the one sanctioned chain-direct DISPLAY read: a detector
// cannot learn the real chain tip from the lagging projection it is measuring. Fight deadline starvation rides
// the existing fight projection, so it adds no poller/store. A failed sample never falsely declares recovery.
//
// Owner redesign (was a full-width red alarm bar): a compact, non-invasive corner chip with a progress bar
// and a LOCALLY predicted ETA. Top-right — the in-world HUD's minimap lives bottom-right and the chat panel
// owns bottom-left, so top-right is the one corner nothing else claims across every route.
//
// The ETA is a pure fold over the SAME polled samples this component already reads (see ./sync_eta) — no
// new poller, no store: one local `useState` derived by one `useEffect` edge that feeds the pure reducer.
// A fresh lag episode (not-lagging → lagging) resets the fold so an old, larger incident's peak never makes
// a small new one look falsely "almost done".

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { get_sdk } from '../chain/sdk'
import { use_fight_view } from '../game/store.js'
import { get_status } from '../rpc/client'
import { resolve_checkpoint_lag, type CheckpointLag } from '../rpc/checkpoint_lag'
import { fold_sync_sample, format_eta_duration, project_sync_status, type SyncEstimatorState } from '../rpc/sync_eta'
import { use_rpc_view } from '../rpc/use_view'

const POLL_MS = 15_000

async function read_checkpoint_lag(signal: AbortSignal): Promise<CheckpointLag> {
  const chain_tip = get_sdk().then(async ({ grpc_client }) => {
    const result = await grpc_client.ledgerService.getServiceInfo({}, { abort: signal })
    return result.response.checkpointHeight
  })
  const [checkpoint_height, status] = await Promise.all([chain_tip, get_status(signal)])

  const lag = resolve_checkpoint_lag(checkpoint_height, status.status === 'ok' ? status.committer_watermark : null)
  if (!lag) throw new Error('checkpoint lag sample has no committed watermark')
  return lag
}

export function RpcLagBanner() {
  const { t } = useTranslation()
  const { data } = use_rpc_view(read_checkpoint_lag, { deps: [], interval_ms: POLL_MS })
  const fight_deadline_starved = use_fight_view()?.deadline_starved ?? false
  const [estimator, set_estimator] = useState<SyncEstimatorState | null>(null)
  const was_lagging_ref = useRef(false)

  const lagging = data?.lagging ?? false
  const remaining = data?.remaining_checkpoints

  // The one edge that feeds the pure fold: a new polled count in, next estimator state out. Resets the
  // fold when a lag episode freshly starts so the progress bar's peak always tracks THIS episode.
  useEffect(() => {
    if (!lagging || remaining == null) {
      was_lagging_ref.current = false
      return
    }
    const episode_started = !was_lagging_ref.current
    was_lagging_ref.current = true
    set_estimator((prev) => fold_sync_sample(episode_started ? null : prev, { t: Date.now(), remaining }))
  }, [remaining, lagging])

  if (!lagging && !fight_deadline_starved) return null

  const projection = project_sync_status(estimator)
  const stalled = fight_deadline_starved || projection.status === 'stalled'
  const accent = stalled ? '#ef4444' : '#f59e0b'
  const pct = lagging ? Math.round(projection.progress * 100) : 0

  const status_label = fight_deadline_starved
    ? t('rpc.reconnecting')
    : stalled
      ? t('rpc.sync_stalled')
      : projection.eta_ms == null
        ? t('rpc.sync_measuring')
        : (({ value, unit }) =>
            unit === 'min' ? t('rpc.sync_eta_min', { value }) : t('rpc.sync_eta_hour', { value }))(
            format_eta_duration(projection.eta_ms)
          )

  return (
    <div
      className="fixed top-14 right-3 z-40 w-56 pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={`border bg-surface/90 backdrop-blur-xl p-2.5 flex flex-col gap-1.5 ${stalled ? 'border-red-500/50' : 'border-gold/30'}`}
      >
        <div className="flex items-center gap-1.5">
          {stalled ? (
            <AlertTriangle size={11} className="text-red-400 shrink-0" />
          ) : (
            <RefreshCw size={11} className="text-amber-400 shrink-0" />
          )}
          <span className="min-w-0 flex-1 text-[9px] tracking-[0.15em] uppercase font-mono text-muted">
            {t('rpc.sync_label')}
          </span>
          {lagging && remaining != null && (
            <span className="text-[9px] font-mono tabular-nums text-text/80 whitespace-nowrap">
              {remaining.toLocaleString()}
            </span>
          )}
        </div>
        <div className="h-1 w-full bg-border/60 overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${pct}%`, background: accent, boxShadow: `0 0 6px ${accent}80` }}
          />
        </div>
        <span
          className={`text-[9px] font-mono tracking-[0.08em] uppercase whitespace-nowrap ${stalled ? 'text-red-400 animate-pulse' : 'text-muted'}`}
        >
          {status_label}
        </span>
      </div>
    </div>
  )
}
