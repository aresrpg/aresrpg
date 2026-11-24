// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useEffect, type ReactNode } from 'react'

import { useInspections } from '../components/useInspections.ts'
import { InspectionWindow, type Inspection } from '../components/ItemDetailView.tsx'
import { docs_path, type DocsReference, type ReferenceView } from '../docs/routes.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { spell_name, stat_name } from '../i18n/copy.ts'

import { CatalogueItemDetails } from './CatalogueItemDetails.tsx'
import { ClassesTab } from './ClassesTab.tsx'
import { encyclopedia_layout } from './components.tsx'
import { encyclopedia_text } from './copy.ts'
import { ItemsTab } from './ItemsTab.tsx'
import { JobsTab } from './JobsTab.tsx'
import { MobsTab } from './MobsTab.tsx'
import { WorldsTab } from './WorldsTab.tsx'

import './encyclopedia.css'

/** The docs' reference views. A pick navigates to the docs address of the picked object. */
export const EncyclopediaContent = ({
  copy,
  navigate,
  view,
}: Readonly<{ copy: AppCopy; navigate: (pathname: string) => void; view: ReferenceView }>) => {
  const text = useMemo(() => encyclopedia_text(copy), [copy])
  const { inspections: windows, open, close: close_window } = useInspections()
  useEffect(() => {
    if (!view.id) return
    if (view.section === 'items') open('item')(view.id)
    if (view.section === 'bestiary') open('mob')(view.id)
  }, [view.section, view.id, open])
  const close = (entry: Inspection) => {
    close_window(entry)
    if (view.id === entry.id) navigate(docs_path(view.section))
  }
  const pick_item = view.section === 'items' ? (id: string) => navigate(docs_path('items', id)) : open('item')
  const pick_mob = view.section === 'bestiary' ? (id: string) => navigate(docs_path('bestiary', id)) : open('mob')
  const inspection_props = {
    labels: {
      characteristics: text('characteristics'),
      damages: text('damages'),
      level_short: '',
      range_to: text('range_to'),
    },
  }

  const views: Readonly<Record<DocsReference, ReactNode>> = {
    items: (
      <ItemsTab
        select_item={pick_item}
        select_mob={pick_mob}
        select_world={(id) => navigate(docs_path('worlds', id))}
        selected_id={view.id}
        stat_name={(stat) => stat_name(copy, stat)}
        text={text}
      />
    ),
    bestiary: (
      <MobsTab
        select_item={pick_item}
        select_mob={pick_mob}
        select_world={(id) => navigate(docs_path('worlds', id))}
        selected_id={view.id}
        text={text}
      />
    ),
    classes: (
      <ClassesTab
        select_class={(id) => navigate(docs_path('classes', id))}
        selected_id={view.id}
        spell_name={(identity) => spell_name(copy, identity)}
        text={text}
      />
    ),
    jobs: (
      <JobsTab
        select_item={pick_item}
        select_job={(id) => navigate(docs_path('jobs', id))}
        selected_id={view.id}
        text={text}
      />
    ),
    worlds: (
      <WorldsTab
        selected_place={view.place}
        select_place={(world, place) => navigate(docs_path('worlds', world, place))}
        select_item={pick_item}
        select_mob={pick_mob}
        select_world={(id) => navigate(docs_path('worlds', id))}
        selected_id={view.id}
        text={text}
      />
    ),
  }
  return (
    <div className={encyclopedia_layout.body} data-encyclopedia-tab={view.section}>
      {views[view.section]}
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
