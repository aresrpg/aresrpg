// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Swords, Shield, Sparkles, Hammer, Wheat, Users, ArrowLeft } from 'lucide-react'
import { JOBS } from '@aresrpg/sdk/jobs'

import { SectionDivider, SectionTitle } from '../../components/entity_display'
import { ItemImage } from '../../components/items'
import jobs_data from '../../data/jobs.json'
import { use_template_t } from '../../i18n/template_t'
import { normalize_search } from '../../utils/search'
import { get_encyclopedia, get_rare_links } from '../../rpc/client'
import { use_rpc_view } from '../../rpc/use_view'

import { gather_ladder_of } from './world_corpus'
import { encyclopedia_item_asset } from './encyclopedia_assets'
import { rare_variants_by_base } from './gather_rare'
import { JobRecipesSection } from './job_recipes_section'

const { JOB_MASTER_JOBS, CRAFT_XP_TABLE } = jobs_data
// widened view: job ids index a plain string map (the JSON's exact shape would reject j.id)
const { JOB_CRAFT_LABEL }: { JOB_CRAFT_LABEL: Record<string, string> } = jobs_data

const JOB_CATEGORIES = ['Gathering', 'Weapon Craft', 'Equipment Craft', 'Consumable Craft'] as const

function slugify_category(cat: string) {
  return cat.toLowerCase().replace(/\s+/g, '_')
}

const JOB_CATEGORY_ICONS: Record<string, any> = {
  Gathering: Wheat,
  'Weapon Craft': Swords,
  'Equipment Craft': Shield,
  'Consumable Craft': Sparkles,
}

function JobsTab({
  selected_job_id,
  on_select_job,
  on_navigate_to_item,
  npcs,
  is_mobile,
}: {
  selected_job_id: string | null
  on_select_job: (id: string) => void
  on_navigate_to_item: (id: string) => void
  npcs: any[]
  is_mobile: boolean
}) {
  const { t } = useTranslation()
  const tt = use_template_t()
  const [search, set_search] = useState('')

  const selected_job = JOB_MASTER_JOBS.find((j) => j.id === selected_job_id)

  // Find NPC master for selected job
  const job_npc = useMemo(() => {
    if (!selected_job_id || !npcs.length) return null
    return npcs.find((npc: any) => npc.type === 'JOB_MASTER' && npc.dialogText === selected_job_id)
  }, [selected_job_id, npcs])

  const { data: enc } = use_rpc_view((signal) => get_encyclopedia(undefined, signal), { deps: [] })
  const { data: rare_links } = use_rpc_view((signal) => get_rare_links(undefined, signal), { deps: [] })
  const job_index = selected_job_id ? JOBS.findIndex((j) => j.id === selected_job_id.toLowerCase()) : -1

  // Gathering progression = the AUTHORED corpus ladder (world_corpus.ts), the ONE home shared with the
  // worlds tab: each resource at its re-tiered tier/level, XP from the on-chain gather_xp curve. Replaces
  // the old join over bundled content.ts items, whose pre-re-tier tiers/levels drifted (diamond showed at
  // T1) — the literal source of truth now lives in the seed, derived, never hardcoded.
  const gather_ladder = gather_ladder_of(selected_job_id)

  // The gather ladder's jackpot twins: base resource template id -> its live rare-variant /v1 item. The
  // ladder rows carry the base template id, so the column is pure linkage — a re-authored rare link moves
  // with the chain, no frontend list to edit.
  const rare_by_base = useMemo(() => rare_variants_by_base(rare_links, enc?.items), [rare_links, enc])

  const is_gathering = selected_job?.category === 'Gathering'

  // Filter jobs by search
  const filtered_jobs = useMemo(() => {
    if (!search.trim()) return JOB_MASTER_JOBS
    const q = normalize_search(search)
    return JOB_MASTER_JOBS.filter(
      (j) =>
        normalize_search(j.label).includes(q) ||
        normalize_search(j.category).includes(q) ||
        normalize_search(JOB_CRAFT_LABEL[j.id] || '').includes(q)
    )
  }, [search])

  // --- LEFT PANEL ---
  const job_list_panel = (
    <div
      className={`flex flex-col gap-0 ${is_mobile ? 'flex-1 min-h-0' : 'border-r border-border'}`}
      style={is_mobile ? undefined : { width: 300, minWidth: 300 }}
    >
      <div className="relative p-2">
        <Search size={14} className="absolute left-5 top-1/2 -translate-y-1/2 opacity-30 pointer-events-none" />
        <input
          className="template-input w-full"
          placeholder={t('encyclopedia.search_jobs')}
          value={search}
          onChange={(e) => set_search(e.target.value)}
          style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', paddingLeft: 36 }}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {JOB_CATEGORIES.map((category) => {
          const jobs_in_cat = filtered_jobs.filter((j) => j.category === category)
          if (!jobs_in_cat.length) return null
          const CatIcon = JOB_CATEGORY_ICONS[category] || Hammer
          return (
            <div key={category}>
              <div
                className="flex items-center gap-2 px-3 py-2 border-b border-border"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <CatIcon size={10} className="text-gold opacity-50" />
                <span className="text-[8px] tracking-[0.2em] uppercase text-gold/70 font-semibold">
                  {t(`encyclopedia.job_category.${slugify_category(category)}`, category)}
                </span>
              </div>
              {jobs_in_cat.map((job) => {
                const is_active = selected_job_id === job.id
                return (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-border/50"
                    style={{
                      background: is_active ? 'rgba(200,150,60,0.1)' : 'transparent',
                      borderLeft: is_active ? '2px solid var(--color-gold)' : '2px solid transparent',
                    }}
                    onClick={() => on_select_job(job.id)}
                    onMouseEnter={(e) => {
                      if (!is_active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.background = is_active
                        ? 'rgba(200,150,60,0.1)'
                        : 'transparent'
                    }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span
                        className={`text-[10px] tracking-[0.1em] uppercase truncate ${is_active ? 'text-gold' : 'text-text'}`}
                      >
                        {job.label}
                      </span>
                      <span className="text-[8px] text-muted truncate">{JOB_CRAFT_LABEL[job.id] || ''}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )

  // --- RIGHT PANEL ---
  const job_detail_panel = (
    <div className={`flex-1 overflow-y-auto ${is_mobile ? 'p-3' : 'p-4 pt-6'}`}>
      {!selected_job ? (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
          <Hammer size={24} style={{ opacity: 0.2 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.select_job')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-w-2xl">
          {/* Header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {(() => {
                const Icon = JOB_CATEGORY_ICONS[selected_job.category] || Hammer
                return <Icon size={18} className="text-gold" />
              })()}
              <h2 className="text-[16px] tracking-[0.15em] uppercase text-gold font-semibold">{selected_job.label}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 border border-gold/30 text-gold/70">
                {t(`encyclopedia.job_category.${slugify_category(selected_job.category)}`, selected_job.category)}
              </span>
              <span className="text-[8px] tracking-[0.15em] uppercase text-muted">
                {t('encyclopedia.crafts')}: {JOB_CRAFT_LABEL[selected_job.id] || '-'}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-text/80 mt-1">
              {t(`encyclopedia.job_desc.${selected_job.id}`)}
            </p>
          </div>

          {/* NPC Master */}
          <div className="flex flex-col gap-2">
            <SectionDivider />
            <SectionTitle title={t('encyclopedia.job_master_npc')} />
            {job_npc ? (
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Users size={12} className="text-gold opacity-50" />
                <span className="text-[10px] tracking-[0.1em] uppercase text-text">{tt(job_npc, 'name')}</span>
              </div>
            ) : (
              <span className="text-[9px] text-muted italic">{t('encyclopedia.no_npc_found')}</span>
            )}
          </div>

          {/* Gathering Progression (for gathering jobs) */}
          {is_gathering && gather_ladder.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionDivider />
              <SectionTitle title={t('encyclopedia.gathering_tiers')} />
              <div className="flex flex-col gap-0">
                {/* Table header */}
                <div
                  className="flex items-center gap-0 px-2 py-1.5 border-b border-border"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted w-12">
                    {t('encyclopedia.tier')}
                  </span>
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted w-16">
                    {t('encyclopedia.required_level')}
                  </span>
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted flex-1">
                    {t('encyclopedia.resource')}
                  </span>
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted flex-1">
                    {t('encyclopedia.rare_variant')}
                  </span>
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted w-16 text-right">
                    {t('encyclopedia.xp_per_harvest')}
                  </span>
                </div>
                {gather_ladder.map((row) => {
                  // The tier's jackpot twin, when the chain has one minted; otherwise the honest dash.
                  const rare = rare_by_base.get(row.id)
                  const rare_asset = rare
                    ? encyclopedia_item_asset({
                        id: rare.template_id,
                        item_type: rare.item_type ?? undefined,
                        name: rare.name ?? undefined,
                      })
                    : null
                  return (
                    <div
                      key={row.id}
                      className="flex items-center gap-0 px-2 py-1.5 border-b border-border/30 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => on_navigate_to_item(row.id)}
                    >
                      <span className="text-[9px] text-gold/70 w-12">T{row.tier}</span>
                      <span className="text-[9px] text-muted w-16">
                        {t('entity.level_short', { level: row.level })}
                      </span>
                      <span className="flex items-center gap-2 flex-1 min-w-0">
                        {/* ItemImage keys on the asset SLUG (…/items/{slug}.png), never the 0x id used for nav. */}
                        <ItemImage id={row.slug} style={{ width: 16, height: 16 }} />
                        <span className="text-[9px] truncate hover:underline text-text">{tt(row, 'name')}</span>
                      </span>
                      {rare && rare_asset ? (
                        <span
                          className="flex items-center gap-2 flex-1 min-w-0"
                          onClick={(event) => {
                            event.stopPropagation()
                            on_navigate_to_item(rare.template_id)
                          }}
                        >
                          <ItemImage
                            id={rare_asset.id}
                            image_url={rare_asset.image_url}
                            category={rare.category}
                            style={{ width: 16, height: 16 }}
                          />
                          <span className="text-[9px] truncate hover:underline text-gold">{rare.name ?? ''}</span>
                        </span>
                      ) : (
                        <span className="text-[9px] text-muted/50 flex-1">&mdash;</span>
                      )}
                      <span className="text-[9px] text-cyan w-16 text-right">
                        {t('encyclopedia.xp_suffix', { xp: row.xp })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Craft XP Table (for craft jobs) */}
          {!is_gathering && (
            <div className="flex flex-col gap-2">
              <SectionDivider />
              <SectionTitle title={t('encyclopedia.craft_xp_table')} />
              <p className="text-[10px] leading-relaxed text-text/80">{t('encyclopedia.bulk_craft_note')}</p>
              <div className="flex flex-col gap-0">
                <div
                  className="flex items-center gap-0 px-2 py-1.5 border-b border-border"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted flex-1">
                    {t('encyclopedia.slots')}
                  </span>
                  <span className="text-[8px] tracking-[0.15em] uppercase text-muted w-20 text-right">
                    {t('encyclopedia.xp_awarded')}
                  </span>
                </div>
                {Object.entries(CRAFT_XP_TABLE).map(([slots, xp]) => (
                  <div
                    key={slots}
                    className="flex items-center gap-0 px-2 py-1.5 border-b border-border/30 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-[9px] text-text/80 flex-1">
                      {slots} {t('encyclopedia.slots').toLowerCase()}
                    </span>
                    <span className="text-[9px] text-cyan w-20 text-right">{t('encyclopedia.xp_suffix', { xp })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RECIPES — every job's own crafts, gathering jobs included (#1670). One home: the /v1 recipe
              rows filtered by the chain's own `required_job`. */}
          <JobRecipesSection
            recipes={enc?.recipes}
            items={enc?.items}
            job_index={job_index}
            on_navigate_to_item={on_navigate_to_item}
          />
        </div>
      )}
    </div>
  )

  if (is_mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {selected_job ? (
          <>
            <button
              type="button"
              onClick={() => on_select_job(null as any)}
              className="flex items-center gap-2 px-3 py-2 text-muted text-[10px] tracking-[0.15em] uppercase hover:text-gold transition-colors border-b border-border shrink-0 cursor-pointer"
            >
              <ArrowLeft size={12} /> {t('encyclopedia.back_to_list')}
            </button>
            {job_detail_panel}
          </>
        ) : (
          job_list_panel
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-0 flex-1 min-h-0">
      {job_list_panel}
      {job_detail_panel}
    </div>
  )
}

export { JobsTab }
