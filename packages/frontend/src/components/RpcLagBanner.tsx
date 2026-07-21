// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// App-global chain-freshness chip. Checkpoint lag uses the one sanctioned chain-direct DISPLAY read: a detector
// cannot learn the real chain tip from the lagging projection it is measuring. Fight deadline starvation rides
// the existing fight projection, so it adds no poller/store. A failed sample never falsely declares recovery.
//
// Owner redesign (#208): the syncing state is a one-line, full-width red header at the viewport top. It
// keeps the current numeric checkpoint count and locally predicted status while leaving the minimap corner
// to the overlaid toast stack.
//
// The ETA is a pure fold over the SAME polled samples this component already reads (see ./sync_eta) — no
// new poller, no store: one local `useState` derived by one `useEffect` edge that feeds the pure reducer.
// A fresh lag episode (not-lagging → lagging) resets the fold so an old, larger incident's peak never makes
// a small new one look falsely "almost done".

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { get_sdk } from '../chain/sdk'
import { use_fight_view } from '../game/store.js'
import { get_status } from '../rpc/client'
import { resolve_checkpoint_lag, type CheckpointLag } from '../rpc/checkpoint_lag'
import { fold_sync_sample, format_eta_duration, project_sync_status, type SyncEstimatorState } from '../rpc/sync_eta'
import { use_rpc_view } from '../rpc/use_view'

import { rpc_sync_header } from './rpc_sync_header'

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
  // fold when a lag episode freshly starts so the peak checkpoint count always tracks THIS episode.
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

  return rpc_sync_header({
    syncing: lagging || fight_deadline_starved,
    stalled,
    sync_label: t('rpc.sync_label'),
    status_label,
    remaining: lagging ? remaining : undefined,
  })
}
