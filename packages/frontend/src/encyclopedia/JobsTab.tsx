// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_groups, job_kind_of, type JobKind } from '@aresrpg/immutable'
import { Hammer, Shield, Sparkles, Swords, Wheat } from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'

import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'
import { EncyclopediaBrowser, SearchField } from './components.tsx'
import { JobRecipesSection } from './JobRecipesSection.tsx'

const JOB_CATEGORIES = Object.freeze(Object.keys(job_groups) as JobKind[])
const JOB_ICONS: Readonly<Record<JobKind, ComponentType<{ size?: number; className?: string }>>> = Object.freeze({
  gathering: Wheat,
  weapon_craft: Swords,
  equipment_craft: Shield,
  consumable_craft: Sparkles,
})
type Job = (typeof encyclopedia_catalog.jobs)[number]

const job_category = (job: Job): JobKind => job_kind_of(job.id)

const job_crafts = (job: Job): string => {
  const item_types =
    job.resources.length > 0 ? job.resources.map(({ row }) => row.item_type) : job.recipes.map((row) => row.output_type)
  const categories = [
    ...new Set(item_types.map((item_type) => encyclopedia_catalog.item(item_type)?.item.category).filter(Boolean)),
  ]
  return categories.map((category) => titleize(category!)).join(', ')
}

const Divider = () => <div className="h-px w-full bg-white/6" />
const SectionTitle = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <span className="text-[9px] font-semibold tracking-[0.25em] text-[#6b7280] uppercase">{children}</span>
)

export const JobsTab = ({
  selected_id,
  select_item,
  select_job,
  text,
}: Readonly<{
  selected_id: string | null
  select_item: (id: string) => void
  select_job: (id: string) => void
  text: EncyclopediaText
}>) => {
  const [search, set_search] = useState('')
  const jobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return encyclopedia_catalog.jobs.filter(
      (job) =>
        !query ||
        job.id.toLowerCase().includes(query) ||
        job_category(job).includes(query) ||
        job_crafts(job).toLowerCase().includes(query)
    )
  }, [search])
  const detail = selected_id ? encyclopedia_catalog.job(selected_id) : null
  const category = detail ? job_category(detail) : null
  const CategoryIcon = category ? JOB_ICONS[category] : Hammer

  const job_list = (
    <aside className="enc-browser__list flex w-[300px] shrink-0 flex-col border-r border-border">
      <div className="p-2">
        <SearchField change={set_search} placeholder={text('search_jobs')} value={search} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {JOB_CATEGORIES.map((group) => {
          const rows = jobs.filter((job) => job_category(job) === group)
          if (rows.length === 0) return null
          const Icon = JOB_ICONS[group]
          return (
            <section key={group}>
              <div className="flex items-center gap-2 border-b border-border bg-white/2 px-3 py-2">
                <Icon className="text-[#c8963c] opacity-50" size={10} />
                <span className="text-[8px] font-semibold tracking-[0.2em] text-[#c8963c]/70 uppercase">
                  {text(`job_category.${group}`)}
                </span>
              </div>
              {rows.map((job) => {
                const active = selected_id === job.id
                return (
                  <button
                    className={`flex w-full cursor-pointer flex-col border-b border-l-2 border-b-border/50 px-3 py-2.5 text-left transition-colors ${
                      active ? 'border-l-[#c8963c] bg-[#c8963c]/10' : 'border-l-transparent hover:bg-white/3'
                    }`}
                    key={job.id}
                    onClick={() => select_job(job.id)}
                    type="button"
                  >
                    <span
                      className={`truncate text-[10px] tracking-[0.1em] uppercase ${active ? 'text-[#c8963c]' : 'text-[#e8e4dc]'}`}
                    >
                      {titleize(job.id)}
                    </span>
                    <span className="mt-0.5 truncate text-[8px] text-[#6b7280]">{job_crafts(job)}</span>
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>
    </aside>
  )

  const job_detail = detail && category && (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-6">
      <div className="flex w-full flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <CategoryIcon className="text-[#c8963c]" size={18} />
            <h2 className="text-[16px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
              {titleize(detail.id)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="border border-[#c8963c]/30 px-2 py-0.5 text-[8px] tracking-[0.15em] text-[#c8963c]/70 uppercase">
              {text(`job_category.${category}`)}
            </span>
            <span className="text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
              {text('crafts')}: {job_crafts(detail) || '—'}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[#e8e4dc]/80">{text(`job_desc.${detail.id}`)}</p>
        </header>

        {detail.resources.length > 0 && (
          <section className="flex flex-col gap-2">
            <Divider />
            <SectionTitle>{text('gathering_tiers')}</SectionTitle>
            <div className="flex flex-col">
              <div className="enc-gather-row enc-gather-heading border-b border-border bg-white/3 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
                <span>{text('tier')}</span>
                <span>{text('required_level')}</span>
                <span>{text('resource')}</span>
                <span>{text('rare_variant')}</span>
                <span>{text('xp_per_harvest')}</span>
              </div>
              {detail.resources
                .toSorted((left, right) => left.row.tier - right.row.tier)
                .map(({ row, required_level }) => {
                  const resource = encyclopedia_catalog.item(row.item_type)?.item
                  const rare = row.rare_item_type ? encyclopedia_catalog.item(row.rare_item_type)?.item : null
                  return (
                    <div className="enc-gather-row border-b border-border/30 text-[11px]" key={row.item_type}>
                      <span className="text-gold">
                        <span className="enc-gather-label">{text('tier')}</span>T{row.tier}
                      </span>
                      <span className="text-muted">
                        <span className="enc-gather-label">{text('required_level')}</span>
                        {required_level}
                      </span>
                      <button
                        className="enc-gather-resource text-text"
                        onClick={() => select_item(row.item_type)}
                        type="button"
                      >
                        <span className="enc-gather-label">{text('resource')}</span>
                        <span>
                          {item_icon(row.item_type) && (
                            <img alt="" className="size-5 shrink-0 object-contain" src={item_icon(row.item_type)!} />
                          )}
                          {resource?.name ?? titleize(row.item_type)}
                        </span>
                      </button>
                      {rare ? (
                        <button
                          className="enc-gather-resource text-gold"
                          onClick={() => select_item(rare.item_type)}
                          type="button"
                        >
                          <span className="enc-gather-label">{text('rare_variant')}</span>
                          <span>
                            {item_icon(rare.item_type) && (
                              <img alt="" className="size-5 shrink-0 object-contain" src={item_icon(rare.item_type)!} />
                            )}
                            {rare.name}
                          </span>
                        </button>
                      ) : (
                        <span className="text-muted">
                          <span className="enc-gather-label">{text('rare_variant')}</span>—
                        </span>
                      )}
                      <span className="text-cyan">
                        <span className="enc-gather-label">{text('xp_per_harvest')}</span>
                        {10 + Math.floor(required_level / 2)} XP
                      </span>
                    </div>
                  )
                })}
            </div>
          </section>
        )}

        <JobRecipesSection recipes={detail.recipes} select_item={select_item} text={text} />
      </div>
    </div>
  )

  return <EncyclopediaBrowser back={() => select_job('')} text={text} list={job_list} detail={job_detail} />
}
