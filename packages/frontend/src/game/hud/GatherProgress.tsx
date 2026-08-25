// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import { content_catalog } from '../../content/catalog.ts'
import { item_icon } from '../../content/assets.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { copy_text } from '../../i18n/copy.ts'
import type { PendingGather } from '../../modules/world.ts'
import { useAppStore } from '../../store.ts'
import { HudPanel } from '../../components/ui/HudPanel.tsx'

export const gather_progress = (
  gathering: Readonly<PendingGather>,
  now_ms: number
): Readonly<{ percent: number; remaining_seconds: number }> => {
  const span = Math.max(1, gathering.ends_at_ms - gathering.started_at_ms)
  const elapsed = Math.max(0, Math.min(span, now_ms - gathering.started_at_ms))
  return Object.freeze({
    percent: Math.round((elapsed * 100) / span),
    remaining_seconds: Math.ceil(Math.max(0, gathering.ends_at_ms - now_ms) / 1_000),
  })
}

export const GatherProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const gathering = useAppStore(({ world, session }) =>
    world.gathering?.character_id === session.selected_character_id && !world.gathering.ambushed
      ? world.gathering
      : null
  )
  const [now, set_now] = useState(Date.now())
  useEffect(() => {
    if (!gathering) return undefined
    set_now(Date.now())
    const timer = setInterval(() => set_now(Date.now()), 100)
    return () => clearInterval(timer)
  }, [gathering])
  if (!gathering) return null
  const text = copy_text(copy.world_hud)
  const item = content_catalog.item(gathering.item_type)?.item
  const name = item?.name ?? gathering.item_type
  const icon = item_icon(gathering.item_type)
  const progress = gather_progress(gathering, now)
  return (
    <HudPanel className="pointer-events-none absolute top-1/2 left-1/2 w-[min(360px,calc(100vw-48px))] -translate-1/2 border-t-[#c8963c]/70 px-5 py-4">
      <div className="flex items-center gap-3">
        {icon && <img alt="" aria-hidden="true" className="size-9 shrink-0 object-contain" src={icon} />}
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[7px] tracking-[0.2em] text-[#7d828b] uppercase">{text('resource_gathering')}</p>
          <div className="flex items-center justify-between gap-4 text-[9px] tracking-[0.16em] uppercase">
            <span className="truncate text-[#e8e4dc]">{name}</span>
            <span className="shrink-0 text-[#c8963c]">{progress.remaining_seconds}s</span>
          </div>
          <div
            aria-label={`${text('resource_gathering')} ${name}`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress.percent}
            className="mt-2 h-2 overflow-hidden border border-white/10 bg-black/55"
            role="progressbar"
          >
            <span
              aria-hidden="true"
              className="block h-full bg-[linear-gradient(90deg,#8b6539,#d9af57)] transition-[width] duration-100 ease-linear"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </div>
    </HudPanel>
  )
}
