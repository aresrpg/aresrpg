// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The characters meta-page — the per-character management sheet. The app-wide CharacterTabs
// strip (AppShell) owns WHICH character is selected; this page renders the selected one's
// detail tabs: EQUIPMENT / STATS / SPELLS / JOBS / RUNEFORGE — the same strip the old
// CharactersDrawer page variant carried, minus its in-page roster (the tab bar replaced it).
// Tab bodies are keyed by character id so switching characters remounts them fresh,
// dropping any staged (uncommitted) equipment or stat edits — the old drawer's law.

import { lazy, Suspense } from 'react'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

// the doll/rows/stat-row primitives every character surface shares (one home)
import '../components/character_surfaces.css'
import './characters.css'

const EquipmentTab = lazy(() => import('./EquipmentTab.tsx'))
const StatsTab = lazy(() => import('./StatsTab.tsx'))
const SpellsTab = lazy(() => import('./SpellsTab.tsx'))
const JobsTab = lazy(() => import('./JobsTab.tsx'))
const RuneforgeTab = lazy(() => import('./RuneforgeTab.tsx'))

const DETAIL_TABS = ['equipment', 'stats', 'spells', 'jobs', 'runeforge'] as const
type DetailTab = (typeof DETAIL_TABS)[number]

export const character_detail_tab = (pathname: string): DetailTab => {
  const tab = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean)[1]
  return DETAIL_TABS.find((candidate) => candidate === tab) ?? 'equipment'
}

export const character_detail_path = (tab: DetailTab): string => `/characters/${tab}`

export default function CharactersPage({ copy }: Readonly<{ copy: AppCopy }>) {
  const t = copy_text(copy.characters_page)
  const character = useAppStore(({ session }) =>
    session.characters.find(({ id }) => id === session.selected_character_id)
  )
  const roster_loaded = useAppStore(({ session }) => session.roster_loaded)
  const pathname = useAppStore(({ navigation }) => navigation.pathname)
  const tab = character_detail_tab(pathname)

  return (
    <section className="gw-tab pointer-events-auto flex min-h-full min-w-0 flex-1 flex-col border border-border bg-bg/97">
      <nav aria-label={copy.characters} className="flex shrink-0 items-stretch border-b border-border">
        {DETAIL_TABS.map((key) => {
          const active = key === tab
          return (
            <button
              className={`cursor-pointer border-b-2 px-5 py-2.5 text-[9px] font-semibold tracking-[0.24em] uppercase transition-colors ${
                active ? 'border-gold text-gold' : 'border-transparent text-muted hover:text-text'
              }`}
              data-character-detail-tab={key}
              key={key}
              onClick={() => dispatch_app({ type: 'path/open', pathname: character_detail_path(key) })}
              type="button"
            >
              {t(`tab_${key}`)}
            </button>
          )
        })}
      </nav>
      {!character ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <p className="text-[10px] tracking-[0.2em] text-muted uppercase">
            {roster_loaded ? t('no_character') : copy.loading_universe}
          </p>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="grid flex-1 place-items-center text-[9px] tracking-[0.18em] text-gold uppercase">
              {copy.loading_universe}
            </div>
          }
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" key={character.id}>
            {tab === 'equipment' && <EquipmentTab character={character} copy={copy} />}
            {tab === 'stats' && <StatsTab character={character} copy={copy} />}
            {tab === 'spells' && <SpellsTab character={character} copy={copy} />}
            {tab === 'jobs' && <JobsTab character={character} copy={copy} />}
            {tab === 'runeforge' && <RuneforgeTab character={character} copy={copy} />}
          </div>
        </Suspense>
      )}
    </section>
  )
}
