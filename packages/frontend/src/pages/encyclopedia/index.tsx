// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { app_mobile_classes, use_mobile_mode } from '../../game/screens/hud/mobile_layout.js'
import { use_fight_view, use_game_state } from '../../game/store.js'
import { get_encyclopedia } from '../../rpc/client'
import { use_rpc_view } from '../../rpc/use_view'

import { use_content } from './content'
import { is_living_world } from './living_corpus'
import { world_corpus_of } from './world_corpus'
import { ItemsTab } from './items_tab'
import { BestiaryTab } from './bestiary_tab'
import { ClassesTab } from './classes_tab'
import { JobsTab } from './jobs_tab'
import { GameplayTab } from './gameplay_tab'
import { use_encyclopedia_spell_seat } from './spell_seat'
import { WorldTab, type WorldRow } from './world_tab'

// T8 (board ticket #8): the DUNGEONS tab was deleted — the seed has no dungeon content and the tab only ever
// rendered an empty stub (content.ts's `templates.dungeon` was hardcoded `[]`), which is exactly the
// "shows fake/empty data as a real feature" bug this pass removes. ITEMS/BESTIARY read real on-chain
// templates directly inside items_tab.tsx/bestiary_tab.tsx (use_onchain_templates) instead of the bundled
// content.ts feed; JOBS' craftable-items list joined the same on-chain source — the
// bundled seed snapshot was never generated past level 110, so recipes above it could never show — only
// CLASSES/GAMEPLAY and JOBS' NPC-master lookup still use content.ts's static seeded data (intentionally
// out of scope for this pass).
type EncyclopediaTab = 'ITEMS' | 'BESTIARY' | 'CLASSES' | 'JOBS' | 'WORLDS' | 'GAMEPLAY'

const TAB_MAP: Record<string, EncyclopediaTab> = {
  items: 'ITEMS',
  bestiary: 'BESTIARY',
  classes: 'CLASSES',
  jobs: 'JOBS',
  worlds: 'WORLDS',
  gameplay: 'GAMEPLAY',
}

const TAB_PATH: Record<EncyclopediaTab, string> = {
  ITEMS: 'items',
  BESTIARY: 'bestiary',
  CLASSES: 'classes',
  JOBS: 'jobs',
  WORLDS: 'worlds',
  GAMEPLAY: 'gameplay',
}

/** Honest label for a world we hold no authored knowledge of — an elided object id, never a fake name. */
const short_world_id = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)

function ItemsTabRoute({ is_mobile }: { is_mobile: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <ItemsTab
      selected_item_id={id || null}
      on_select_item={(item_id) =>
        navigate(item_id ? `/encyclopedia/items/${item_id}${location.search}` : `/encyclopedia/items${location.search}`)
      }
      on_navigate_to_mob={(mob_id) => navigate(`/encyclopedia/bestiary/${mob_id}`)}
      on_navigate_to_world={(world_id) => navigate(`/encyclopedia/worlds/${world_id}`)}
      is_mobile={is_mobile}
    />
  )
}

function BestiaryTabRoute({ is_mobile }: { is_mobile: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <BestiaryTab
      selected_mob_id={id || null}
      on_select_mob={(mob_id) =>
        navigate(
          mob_id ? `/encyclopedia/bestiary/${mob_id}${location.search}` : `/encyclopedia/bestiary${location.search}`
        )
      }
      on_navigate_to_item={(item_id) => navigate(`/encyclopedia/items/${item_id}`)}
      on_navigate_to_world={(world_id) => navigate(`/encyclopedia/worlds/${world_id}`)}
      is_mobile={is_mobile}
    />
  )
}

function ClassesTabRoute({ classes, is_mobile }: { classes: any[]; is_mobile: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const character = use_game_state(
    (state) => state.sui.characters?.find((character: any) => character.id === state.selected_character_id) ?? null
  )
  const fight = use_fight_view()
  const fight_seat = character?.id ? (fight?.fighters.get(character.id) ?? null) : null
  const seat = use_encyclopedia_spell_seat(character, fight_seat)
  return (
    <ClassesTab
      selected_class_id={id || null}
      on_select_class={(class_id) => navigate(`/encyclopedia/classes/${class_id}`)}
      on_navigate_to_item={(item_id) => navigate(`/encyclopedia/items/${item_id}`)}
      classes={classes}
      is_mobile={is_mobile}
      seat={seat}
    />
  )
}

// §14 WORLD tab — the chain says WHICH worlds are live, the authored corpus says what they ARE.
// /v1/encyclopedia?kind=worlds serves only {world_id, seed, biome} — `world_id` is the world OBJECT id
// (0x…), never a slug, so it can never be prettified into a name (that bug is why every card read as a
// raw address). Name / level band / mob roster / gatherable resources are AUTHORED corpus facts and /v1
// projects none of them (its mob rows carry no world provenance at all) — they are joined from the
// seed-generated, freshness-gated world_corpus artifact. See world_corpus.ts for the full rationale.
function WorldsTabRoute({ is_mobile }: { is_mobile: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: enc, loading } = use_rpc_view((signal) => get_encyclopedia('worlds', signal), { deps: [] })
  // Living-generation fence (living_corpus.ts): /v1 lists every World object ever minted on this lineage;
  // rows outside the current seed manifest's world set are old-generation ghosts — hidden.
  const worlds: WorldRow[] = (enc?.worlds ?? []).filter(is_living_world).map((w) => {
    const corpus = world_corpus_of(w.world_id)
    // Unreachable by construction (living_ids and world_corpus are generated from the SAME manifest), but
    // a world we have no authored knowledge of degrades honestly instead of inventing a name or a band.
    if (!corpus) return { id: w.world_id, name: short_world_id(w.world_id), band: null, biome: w.biome || '' }
    return {
      id: w.world_id,
      name: corpus.name,
      band: corpus.band,
      biome: corpus.biome || w.biome || '',
      address: w.world_id,
      mobs: corpus.mobs,
      resources: corpus.resources.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        i18nJson: r.i18nJson,
        category: 'RESOURCE',
        job: r.job,
        tier: r.tier,
        level: r.level,
      })),
    }
  })
  return (
    <WorldTab
      worlds={worlds}
      loading={loading}
      is_mobile={is_mobile}
      selected_world_id={id || null}
      on_select_world={(world_id) => navigate(world_id ? `/encyclopedia/worlds/${world_id}` : '/encyclopedia/worlds')}
      on_select_mob={(mob_id) => navigate(`/encyclopedia/bestiary/${mob_id}`)}
      on_select_item={(item_id) => navigate(`/encyclopedia/items/${item_id}`)}
    />
  )
}

function JobsTabRoute({ npcs, is_mobile }: { npcs: any[]; is_mobile: boolean }) {
  const { id } = useParams()
  const navigate = useNavigate()
  return (
    <JobsTab
      selected_job_id={id || null}
      on_select_job={(job_id) => navigate(`/encyclopedia/jobs/${job_id}`)}
      on_navigate_to_item={(item_id) => navigate(`/encyclopedia/items/${item_id}`)}
      npcs={npcs}
      is_mobile={is_mobile}
    />
  )
}

export function EncyclopediaPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const is_mobile = use_mobile_mode()
  const mobile_classes = app_mobile_classes(is_mobile)

  // Bundled/static seed content — still feeds CLASSES (hardcoded content, untouched by
  // this pass) and JOBS' NPC-master lookup. ITEMS/BESTIARY read on-chain templates directly (see
  // items_tab.tsx/bestiary_tab.tsx); JOBS' craftable-items list now does too (see jobs_tab.tsx) — the
  // old bundled item snapshot (packages/sdk/src/items.json) was never generated past level 110, so
  // nothing above it could ever show there.
  const { templates, fetch_templates } = use_content()

  useEffect(() => {
    fetch_templates('class')
    fetch_templates('npc')
  }, [])

  const classes = templates.class || []
  const npcs = templates.npc || []

  // Derive active tab from URL
  const path_segment = location.pathname.split('/')[2] || 'items'
  const active_tab = TAB_MAP[path_segment] || 'ITEMS'

  const navigate_tab = (tab: EncyclopediaTab) => {
    navigate(`/encyclopedia/${TAB_PATH[tab]}`)
  }

  return (
    // QA finding: the page read too dark (item icons barely legible on the near-black body). A
    // subtle lift from --color-bg (#0a0a0f) toward --color-surface (#12121a) — one token, no restyle.
    <div className={`${mobile_classes.page} flex flex-col gap-0 h-full min-h-0 bg-surface/50`}>
      {/* Mobile (P0 #94 / P2): the tab pills overflowed a 390px phone. Let the strip scroll
          horizontally (pills stay full size, no crush) and trim the padding; desktop keeps lg:px-4. */}
      <div
        data-mobile-page-tabs
        className={`${mobile_classes.page_tabs} flex items-center gap-1 border-b border-border px-2 lg:px-4 py-2 lg:py-3 overflow-x-auto [&>*]:shrink-0`}
      >
        {(['ITEMS', 'BESTIARY', 'CLASSES', 'JOBS', 'WORLDS', 'GAMEPLAY'] as const).map((tab) => {
          const tab_labels: Record<EncyclopediaTab, string> = {
            ITEMS: t('encyclopedia.items'),
            BESTIARY: t('encyclopedia.mobs'),
            CLASSES: t('encyclopedia.classes'),
            JOBS: t('encyclopedia.jobs_tab'),
            WORLDS: t('encyclopedia.worlds_tab'),
            GAMEPLAY: t('encyclopedia.gameplay_tab'),
          }
          return (
            <button
              type="button"
              key={tab}
              className={`category-pill ${active_tab === tab ? 'active' : ''}`}
              onClick={() => navigate_tab(tab)}
            >
              {tab_labels[tab]}
            </button>
          )
        })}
      </div>
      <Routes>
        <Route path="items" element={<ItemsTabRoute is_mobile={is_mobile} />} />
        <Route path="items/:id" element={<ItemsTabRoute is_mobile={is_mobile} />} />
        <Route path="mobs" element={<Navigate to="/encyclopedia/bestiary" replace />} />
        <Route path="bestiary" element={<BestiaryTabRoute is_mobile={is_mobile} />} />
        <Route path="bestiary/:id" element={<BestiaryTabRoute is_mobile={is_mobile} />} />
        <Route path="classes" element={<ClassesTabRoute classes={classes} is_mobile={is_mobile} />} />
        <Route path="classes/:id" element={<ClassesTabRoute classes={classes} is_mobile={is_mobile} />} />
        <Route path="jobs" element={<JobsTabRoute npcs={npcs} is_mobile={is_mobile} />} />
        <Route path="jobs/:id" element={<JobsTabRoute npcs={npcs} is_mobile={is_mobile} />} />
        <Route path="worlds" element={<WorldsTabRoute is_mobile={is_mobile} />} />
        <Route path="worlds/:id" element={<WorldsTabRoute is_mobile={is_mobile} />} />
        <Route path="gameplay" element={<GameplayTab is_mobile={is_mobile} />} />
        <Route path="*" element={<Navigate to="/encyclopedia/items" replace />} />
      </Routes>
    </div>
  )
}
