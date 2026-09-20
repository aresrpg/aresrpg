// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Text } from '../../i18n/Text.tsx'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { content_catalog } from '../../content/catalog.ts'
import { item_icon } from '../../content/assets.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { copy_text } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { HudPanel } from '../../components/ui/HudPanel.tsx'

import { gather_progress_view } from './gather_progress.ts'

const PROGRESS_POSITION = {
  world: 'absolute top-1/2 left-1/2 -translate-1/2',
  page: 'relative',
} as const

export const BackgroundGatherProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const visible = useAppStore(
    (state) => state.automation.run?.scope.type === 'pack' && state.navigation.page !== 'world'
  )
  return visible
    ? createPortal(
        <div className="fixed right-4 bottom-4 z-[150] font-mono">
          <GatherProgress copy={copy} position="page" />
        </div>,
        document.body
      )
    : null
}

export const GatherProgress = ({
  copy,
  position,
}: Readonly<{ copy: AppCopy; position: keyof typeof PROGRESS_POSITION }>) => {
  const state = useAppStore((value) => value)
  const [now, set_now] = useState(Date.now())
  const progress = gather_progress_view(state, now)
  const active = progress !== null
  useEffect(() => {
    if (!active) return undefined
    set_now(Date.now())
    const timer = setInterval(() => set_now(Date.now()), 100)
    return () => clearInterval(timer)
  }, [active])
  if (!progress) return null
  const text = copy_text(copy.world_hud)
  const item = content_catalog.item(progress.item_type)?.item
  const name = item?.name ?? progress.item_type
  const icon = item_icon(progress.item_type)
  return (
    <HudPanel
      className={`pointer-events-none ${PROGRESS_POSITION[position]} w-[min(360px,calc(100vw-48px))] border-t-[#c8963c]/70 px-5 py-4`}
    >
      <div className="flex items-center gap-3">
        {icon && <img alt="" aria-hidden="true" className="size-9 shrink-0 object-contain" src={icon} />}
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[7px] tracking-[0.2em] text-[#7d828b] uppercase">
            {progress.collect_all
              ? text('resource_collect_all_progress', { completed: progress.completed, total: progress.total })
              : text('resource_gathering')}
          </p>
          <div className="flex items-center justify-between gap-4 text-[9px] tracking-[0.16em] uppercase">
            <span className="truncate text-[#e8e4dc]">{name}</span>
            <span className="shrink-0 text-[#c8963c]">
              {progress.collect_all && '≈ '}
              <Text path="ui.seconds" values={{ count: progress.remaining_seconds }} />
            </span>
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
          {progress.collect_all && (
            <button
              type="button"
              className="pointer-events-auto mt-3 cursor-pointer text-[9px] text-cyan"
              onClick={() => dispatch_app({ type: 'automation/stop', reason: 'stopped' })}
            >
              {text('resource_collect_all_stop')}
            </button>
          )}
        </div>
      </div>
    </HudPanel>
  )
}
