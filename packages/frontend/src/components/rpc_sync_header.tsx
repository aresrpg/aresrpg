// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { RefreshCw } from 'lucide-react'

type rpc_sync_header_props = Readonly<{
  syncing: boolean
  stalled: boolean
  sync_label: string
  status_label: string
  remaining?: number
}>

/** Pure sync-state renderer kept separate from the polling edge so its mount contract stays headless-testable. */
export function rpc_sync_header({ syncing, stalled, sync_label, status_label, remaining }: rpc_sync_header_props) {
  if (!syncing) return null

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] pointer-events-none border-b border-red-400/50 bg-[#0a0a0f]/95 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-rpc-sync-header=""
    >
      <div className="flex h-7 w-full items-center justify-center gap-2 px-3 font-mono text-[9px] uppercase tracking-[0.15em] text-red-300">
        <RefreshCw aria-hidden="true" size={11} className="shrink-0 animate-spin text-red-400" />
        <span className="font-semibold text-red-400">{sync_label}</span>
        {remaining != null && (
          <span className="whitespace-nowrap tabular-nums text-red-200" data-sync-progress="">
            {remaining.toLocaleString()}
          </span>
        )}
        <span className={`whitespace-nowrap text-red-300/80 ${stalled ? 'animate-pulse' : ''}`}>{status_label}</span>
      </div>
    </div>
  )
}
