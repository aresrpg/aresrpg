// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** An ACTIVE fight has no actionable turn until its actor resolves to a fighter row. */
export function fight_actor_unresolved(fight) {
  const actor_id = fight?.active_entity_id
  return actor_id == null || !fight?.fighters?.has?.(actor_id)
}

/** Presentational fight-sync/resolving chip kept store-free so its render contract unit-tests headlessly. */
export function FightSyncBadge({ label, resolving = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-fight-resolving={resolving || undefined}
      className="pointer-events-none fixed left-1/2 top-20 z-[75] flex -translate-x-1/2 items-center gap-2 border border-amber-400/60 bg-black/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.25)] backdrop-blur"
    >
      <span
        className={
          resolving
            ? 'toast-spinner h-3 w-3 rounded-full border border-amber-300/30 border-t-amber-300'
            : 'h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300'
        }
        aria-hidden="true"
      />
      {label}
    </div>
  )
}
