// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The item detail's "DROPPED BY" mob list — extracted verbatim from items_tab.tsx (pure presentation,
// ≤600-LoC law). Rows come pre-sorted best-chance-first from the live /v1 inversion; the empty state is
// the honest no-drops line, never a fabrication.
import { Skull } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useTemplateT } from '../../i18n/template_t'

export interface DroppedByRow {
  id: string
  name: string
  minLevel: number
  maxLevel: number
  chance_percent: number
}

export function DroppedBySection({
  dropped_by,
  on_navigate_to_mob,
}: {
  dropped_by: DroppedByRow[] | null
  on_navigate_to_mob: (id: string) => void
}) {
  const { t } = useTranslation()
  const tt = useTemplateT()
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[9px] tracking-[0.25em] uppercase font-semibold text-muted">
        {t('encyclopedia.dropped_by')}
      </span>
      {dropped_by && dropped_by.length > 0 ? (
        <div className="flex flex-col gap-2">
          {dropped_by.map((mob, idx) => (
            <div
              key={mob.id}
              className="flex items-center justify-between px-3 py-2.5 cursor-pointer transition-none border border-border"
              style={{
                background: idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)',
                borderLeft: '2px solid rgba(200,150,60,0.38)',
              }}
              onClick={() => on_navigate_to_mob(mob.id)}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.background = 'rgba(200,150,60,0.08)'
                el.style.borderColor = 'rgba(200,150,60,0.25)'
                el.style.boxShadow = '0 0 12px rgba(200,150,60,0.1)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.background = idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)'
                el.style.borderColor = 'var(--color-border)'
                el.style.boxShadow = 'none'
              }}
            >
              <span className="text-[10px] tracking-[0.1em] uppercase font-semibold text-gold">{tt(mob, 'name')}</span>
              <div className="flex items-center gap-3 shrink-0">
                {typeof mob.chance_percent === 'number' && (
                  <span className="text-[10px] font-semibold tabular-nums text-gold" title={t('entity.chance')}>
                    {mob.chance_percent.toFixed(2)}%
                  </span>
                )}
                <span className="text-[9px] tracking-[0.1em] uppercase text-muted">
                  {t('encyclopedia.level_range', { min: mob.minLevel, max: mob.maxLevel })}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <Skull size={10} className="opacity-20 text-muted" />
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted italic">{t('encyclopedia.no_drops')}</span>
        </div>
      )}
    </div>
  )
}
