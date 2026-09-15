// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { gather_time_ms, job_max_level } from '@aresrpg/immutable'
import { Timer } from 'lucide-react'

import { useNumbers } from '../i18n/useNumbers.ts'
import { Text } from '../i18n/Text.tsx'
import type { CopyText } from '../i18n/copy.ts'

export const GatheringTime = ({
  level,
  gathering,
  t,
}: Readonly<{ level: number; gathering: boolean; t: CopyText }>) => {
  const numbers = useNumbers()
  if (!gathering) return null
  const seconds = numbers.decimal(gather_time_ms(level) / 1_000, 2, 2)
  const next_seconds = numbers.decimal(gather_time_ms(level + 1) / 1_000, 2, 2)
  return (
    <div className="hud-num flex items-center gap-2 whitespace-nowrap text-sm">
      <span
        aria-label={t('jobs.detail.gather_time', { seconds })}
        className="flex items-center gap-1.5 text-text"
        title={t('jobs.detail.gather_time', { seconds })}
      >
        <Timer aria-hidden="true" className="text-gold" size={14} />
        <strong>
          <Text path="ui.seconds" values={{ count: seconds }} />
        </strong>
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
          <strong className="text-cyan">
            <Text path="ui.seconds" values={{ count: next_seconds }} />
          </strong>
          <span className="text-xs text-muted">{t('jobs.lv_badge', { level: level + 1 })}</span>
        </span>
      )}
    </div>
  )
}
