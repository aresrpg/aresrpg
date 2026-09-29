// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useEffect, useRef } from 'react'

import { useInspections } from '../components/useInspections.ts'
import { InspectionWindow, type Inspection } from '../components/ItemDetailView.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { spell_name, stat_name } from '../i18n/copy.ts'
import { TokenomicsTab } from '../kares/TokenomicsTab.tsx'

import { CatalogueItemDetails } from './CatalogueItemDetails.tsx'
import { ClassesTab } from './ClassesTab.tsx'
import { encyclopedia_layout } from './components.tsx'
import { encyclopedia_text } from './copy.ts'
import { GameplayTab } from './GameplayTab.tsx'
import { ItemsTab } from './ItemsTab.tsx'
import { JobsTab } from './JobsTab.tsx'
import { MobsTab } from './MobsTab.tsx'
import { WorldsTab } from './WorldsTab.tsx'

import './encyclopedia.css'

type Tab = 'items' | 'bestiary' | 'classes' | 'jobs' | 'worlds' | 'gameplay' | 'kares'

export const ENCYCLOPEDIA_TABS: readonly Readonly<{ id: Tab; label: string }>[] = Object.freeze([
  { id: 'items', label: 'items' },
  { id: 'bestiary', label: 'mobs' },
  { id: 'classes', label: 'classes' },
  { id: 'jobs', label: 'jobs_tab' },
  { id: 'worlds', label: 'worlds_tab' },
  { id: 'gameplay', label: 'gameplay_tab' },
  { id: 'kares', label: 'kares' },
])

export const encyclopedia_route_view = (
  pathname: string
): Readonly<{ tab: Tab; id: string | null; place: string | null }> => {
  const [, segment = 'items', encoded_id, kind, encoded_place] = pathname.split('/').filter(Boolean)
  const tab = ENCYCLOPEDIA_TABS.some(({ id }) => id === segment) ? (segment as Tab) : 'items'
  if (!encoded_id) return Object.freeze({ tab, id: null, place: null })
  try {
    return Object.freeze({
      tab,
      id: decodeURIComponent(encoded_id),
      place: encoded_place ? `${kind}:${decodeURIComponent(encoded_place)}` : null,
    })
  } catch (error) {
    console.warn('Ignoring malformed encyclopedia route.', error)
    return Object.freeze({ tab, id: null, place: null })
  }
}

export const encyclopedia_route = (tab: Tab, id?: string | null): string =>
  `/encyclopedia/${tab}${id ? `/${encodeURIComponent(id)}` : ''}`

export const EncyclopediaContent = ({
  copy,
  navigate,
  pathname,
}: Readonly<{ copy: AppCopy; navigate: (pathname: string) => void; pathname: string }>) => {
  const text = useMemo(() => encyclopedia_text(copy), [copy])
  const view = encyclopedia_route_view(pathname)
  const route = encyclopedia_route
  const root = useRef<HTMLDivElement>(null)
  const { inspections: windows, open, close: close_window } = useInspections(root)
  useEffect(() => {
    if (!view.id) return
    if (view.tab === 'items') open('item')(view.id)
    if (view.tab === 'bestiary') open('mob')(view.id)
  }, [view.tab, view.id, open])
  const close = (entry: Inspection) => {
    close_window(entry)
    if (view.id === entry.id) navigate(route(view.tab))
  }
  const pick_item = view.tab === 'items' ? (id: string) => navigate(route('items', id)) : open('item')
  const pick_mob = view.tab === 'bestiary' ? (id: string) => navigate(route('bestiary', id)) : open('mob')
  const inspection_props = {
    labels: {
      characteristics: text('characteristics'),
      damages: text('damages'),
      level_short: '',
      range_to: text('range_to'),
    },
  }

  const views = {
    items: (
      <ItemsTab
        select_item={pick_item}
        select_mob={pick_mob}
        select_world={(id) => navigate(route('worlds', id))}
        selected_id={view.id}
        stat_name={(stat) => stat_name(copy, stat)}
        text={text}
      />
    ),
    bestiary: (
      <MobsTab
        select_item={pick_item}
        select_mob={pick_mob}
        select_world={(id) => navigate(route('worlds', id))}
        selected_id={view.id}
        text={text}
      />
    ),
    classes: (
      <ClassesTab
        select_class={(id) => navigate(route('classes', id))}
        selected_id={view.id}
        spell_name={(identity) => spell_name(copy, identity)}
        text={text}
      />
    ),
    jobs: (
      <JobsTab
        select_item={pick_item}
        select_job={(id) => navigate(route('jobs', id))}
        selected_id={view.id}
        text={text}
      />
    ),
    worlds: (
      <WorldsTab
        selected_place={view.place}
        select_place={(world, place) =>
          navigate(`${route('worlds', world)}/${place.split(':').map(encodeURIComponent).join('/')}`)
        }
        select_item={pick_item}
        select_mob={pick_mob}
        select_world={(id) => navigate(route('worlds', id))}
        selected_id={view.id}
        text={text}
      />
    ),
    kares: <TokenomicsTab copy={copy.kares_page} />,
    gameplay: <GameplayTab text={text} />,
  }
  return (
    <div ref={root} className={encyclopedia_layout.body} data-encyclopedia-tab={view.tab}>
      {views[view.tab]}
      {windows.map((entry) => (
        <InspectionWindow
          key={`${entry.kind}:${entry.id}`}
          entry={entry}
          props={inspection_props}
          open={open}
          close={() => close(entry)}
          render_item={(id) => (
            <CatalogueItemDetails
              item_type={id}
              select_item={open('item')}
              select_mob={open('mob')}
              select_world={open('world')}
              text={text}
              stat_name={(stat) => stat_name(copy, stat)}
            />
          )}
        />
      ))}
    </div>
  )
}
