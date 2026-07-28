// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { RefreshCw } from 'lucide-react'

type rpc_sync_header_props = Readonly<{
  syncing: boolean
  sync_label: string
  status_label: string
  remaining?: number
}>

/** Pure sync-state renderer kept separate from the polling edge so its mount contract stays headless-testable. */
export function rpc_sync_header({ syncing, sync_label, status_label, remaining }: rpc_sync_header_props) {
  if (!syncing) return null

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] pointer-events-none border-b border-border/60 bg-surface/90 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-rpc-sync-header=""
    >
      <div className="flex h-7 w-full items-center justify-center gap-2 px-3 font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
        <RefreshCw aria-hidden="true" size={11} className="shrink-0 animate-spin text-muted/50" />
        <span className="font-medium text-muted/80">{sync_label}</span>
        {remaining != null && (
          <span className="whitespace-nowrap tabular-nums text-muted/70" data-sync-progress="">
            {remaining.toLocaleString()}
          </span>
        )}
        <span className="whitespace-nowrap text-muted/60">{status_label}</span>
      </div>
    </div>
  )
}
