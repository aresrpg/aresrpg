// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { LEADERBOARD_METRICS } from '@aresrpg/protocol'
import { Button, IconButton } from '@aresrpg/ui'
import { Check, Menu } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { useLeaderboardDispatch, useLeaderboardState } from './LeaderboardSource.tsx'

const position_category_menu = (menu: Readonly<HTMLElement>, trigger: Readonly<HTMLElement>): void => {
  const bounds = trigger.getBoundingClientRect()
  const frame = trigger.closest('.aui-window')?.getBoundingClientRect()
  if (!frame) return
  const left = bounds.left + 4
  const top = bounds.bottom + 4
  menu.style.setProperty('left', `${left}px`)
  menu.style.setProperty('top', `${top}px`)
  menu.style.setProperty('max-width', `${Math.max(0, frame.right - left - 8)}px`)
  menu.style.setProperty('max-height', `${Math.max(0, frame.bottom - top - 8)}px`)
}

export const LeaderboardCategories = () => {
  const id = useId()
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dispatch = useLeaderboardDispatch()
  const copy = useAppStore((state) => state.copy)
  const { observation } = useLeaderboardState()
  useEffect(() => {
    const close = () => {
      if (menu.current?.matches(':popover-open')) menu.current.hidePopover()
    }
    globalThis.addEventListener('resize', close)
    return () => globalThis.removeEventListener('resize', close)
  }, [])
  if (!copy) return null
  const text = copy_text(copy.leaderboard_page)
  return (
    <>
      <div className="leaderboard-category-tabs" role="tablist" aria-label={text('category')}>
        {LEADERBOARD_METRICS.map((metric) => (
          <Button
            key={metric}
            type="button"
            role="tab"
            aria-selected={metric === observation.metric}
            className={`leaderboard-category ${metric === observation.metric ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'leaderboards/select', metric })}
          >
            {text(metric)}
          </Button>
        ))}
      </div>
      <IconButton
        ref={trigger}
        className="leaderboard-category-toggle"
        label={`${text('category')}: ${text(observation.metric)}`}
        icon={<Menu size={20} />}
        popoverTarget={id}
      />
      <div
        id={id}
        ref={menu}
        popover="auto"
        className="aui-panel leaderboard-category-menu"
        role="group"
        aria-label={text('category')}
        onBeforeToggle={(event) => {
          if (event.newState === 'open' && trigger.current) position_category_menu(event.currentTarget, trigger.current)
        }}
      >
        {LEADERBOARD_METRICS.map((metric) => (
          <Button
            key={metric}
            className={`leaderboard-category ${metric === observation.metric ? 'active' : ''}`}
            aria-pressed={metric === observation.metric}
            onClick={() => {
              dispatch({ type: 'leaderboards/select', metric })
              menu.current?.hidePopover()
            }}
          >
            {text(metric)}
            {metric === observation.metric && <Check size={15} aria-hidden="true" />}
          </Button>
        ))}
      </div>
    </>
  )
}
