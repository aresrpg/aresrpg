// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { gather_time_ms, job_max_level } from '@aresrpg/immutable'
import { Timer } from 'lucide-react'

import type { CopyText } from '../i18n/copy.ts'

export const GatheringTime = ({
  level,
  gathering,
  t,
}: Readonly<{ level: number; gathering: boolean; t: CopyText }>) => {
  if (!gathering) return null
  const seconds = (gather_time_ms(level) / 1_000).toFixed(2)
  const next_seconds = (gather_time_ms(level + 1) / 1_000).toFixed(2)
  return (
    <div className="hud-num flex items-center gap-2 whitespace-nowrap text-sm">
      <span
        aria-label={t('jobs.detail.gather_time', { seconds })}
        className="flex items-center gap-1.5 text-text"
        title={t('jobs.detail.gather_time', { seconds })}
      >
        <Timer aria-hidden="true" className="text-gold" size={14} />
        <strong>{seconds}s</strong>
      </span>
      {level < job_max_level && (
        <span
          aria-label={t('jobs.detail.next_gather_time', { level: level + 1, seconds: next_seconds })}
          className="flex items-baseline gap-1.5"
          title={t('jobs.detail.next_gather_time', { level: level + 1, seconds: next_seconds })}
        >
          <span aria-hidden="true" className="text-muted">
            →
          </span>
          <strong className="text-cyan">{next_seconds}s</strong>
          <span className="text-xs text-muted">{t('jobs.lv_badge', { level: level + 1 })}</span>
        </span>
      )}
    </div>
  )
}
