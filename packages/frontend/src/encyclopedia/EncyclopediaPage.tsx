// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { stat_name } from '../i18n/copy.ts'

import { ClassesTab } from './ClassesTab.tsx'
import { category_pill, encyclopedia_layout } from './components.tsx'
import { encyclopedia_text } from './copy.ts'
import { GameplayTab } from './GameplayTab.tsx'
import { ItemsTab } from './ItemsTab.tsx'
import { JobsTab } from './JobsTab.tsx'
import { MobsTab } from './MobsTab.tsx'
import { WorldsTab } from './WorldsTab.tsx'

type Tab = 'items' | 'bestiary' | 'classes' | 'jobs' | 'worlds' | 'gameplay'

const TABS: readonly Readonly<{ id: Tab; label: string }>[] = Object.freeze([
  { id: 'items', label: 'items' },
  { id: 'bestiary', label: 'mobs' },
  { id: 'classes', label: 'classes' },
  { id: 'jobs', label: 'jobs_tab' },
  { id: 'worlds', label: 'worlds_tab' },
  { id: 'gameplay', label: 'gameplay_tab' },
])

const route_view = (pathname: string): Readonly<{ tab: Tab; id: string | null }> => {
  const [, segment = 'items', encoded_id] = pathname.split('/').filter(Boolean)
  const tab = TABS.some(({ id }) => id === segment) ? (segment as Tab) : 'items'
  if (!encoded_id) return Object.freeze({ tab, id: null })
  try {
    return Object.freeze({ tab, id: decodeURIComponent(encoded_id) })
  } catch (error) {
    console.warn('Ignoring malformed encyclopedia route.', error)
    return Object.freeze({ tab, id: null })
  }
}

const route = (tab: Tab, id?: string | null): string => `/encyclopedia/${tab}${id ? `/${encodeURIComponent(id)}` : ''}`

export const EncyclopediaPage = ({
  copy,
  navigate,
  pathname,
}: Readonly<{ copy: AppCopy; navigate: (pathname: string) => void; pathname: string }>) => {
  const text = useMemo(() => encyclopedia_text(copy), [copy])
  const view = route_view(pathname)
  return (
    <section className="pointer-events-auto z-[12] flex h-full min-h-0 flex-1 flex-col bg-[#12121a]/50 [&_button:not(:disabled)]:cursor-pointer">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#1e1e2e] px-4 py-3 [&>*]:shrink-0">
        {TABS.map((tab) => (
          <button
            className={category_pill(view.tab === tab.id)}
            key={tab.id}
            onClick={() => navigate(route(tab.id))}
            type="button"
          >
            {text(tab.label)}
          </button>
        ))}
      </nav>
      <div className={encyclopedia_layout.body}>
        {view.tab === 'items' && (
          <ItemsTab
            select_item={(id) => navigate(route('items', id))}
            select_mob={(id) => navigate(route('bestiary', id))}
            select_world={(id) => navigate(route('worlds', id))}
            selected_id={view.id}
            stat_name={(stat) => stat_name(copy, stat)}
            text={text}
          />
        )}
        {view.tab === 'bestiary' && (
          <MobsTab
            select_item={(id) => navigate(route('items', id))}
            select_mob={(id) => navigate(route('bestiary', id))}
            select_world={(id) => navigate(route('worlds', id))}
            selected_id={view.id}
            text={text}
          />
        )}
        {view.tab === 'classes' && (
          <ClassesTab select_class={(id) => navigate(route('classes', id))} selected_id={view.id} text={text} />
        )}
        {view.tab === 'jobs' && (
          <JobsTab
            select_item={(id) => navigate(route('items', id))}
            select_job={(id) => navigate(route('jobs', id))}
            selected_id={view.id}
            text={text}
          />
        )}
        {view.tab === 'worlds' && (
          <WorldsTab
            select_item={(id) => navigate(route('items', id))}
            select_mob={(id) => navigate(route('bestiary', id))}
            select_world={(id) => navigate(route('worlds', id))}
            selected_id={view.id}
            text={text}
          />
        )}
        {view.tab === 'gameplay' && <GameplayTab text={text} />}
      </div>
    </section>
  )
}

export default EncyclopediaPage
