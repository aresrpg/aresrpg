// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RpcStale — the shared "this data isn't live right now" chip (SPEC §14 UI-DATA LAW).
//
// The one visible affordance the no-silent-stale rule demands: any surface reading through use_rpc_view drops
// this in, so a failed poll is ALWAYS shown, never hidden behind a value that merely looks fresh. Gothic
// terminal tokens (amber = degraded, per the design system's status palette) — tiny, uppercase, no radius.
//
//   <RpcStale stale={stale} offline={error != null && data == null} />

import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export function RpcStale({ stale, offline }: { stale?: boolean; offline?: boolean }): ReactElement | null {
  const { t } = useTranslation()
  if (!stale && !offline) return null
  // offline (no data at all) reads harder than stale (holding last-good) — same amber, different copy.
  const label = offline ? t('rpc.unavailable') : t('rpc.reconnecting')
  return (
    <span
      className="text-amber-400 text-[10px] tracking-[0.15em] uppercase whitespace-nowrap animate-pulse"
      role="status"
      title={label}
    >
      ● {label}
    </span>
  )
}
