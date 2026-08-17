// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_groups, job_kind_of, type JobKind } from '@aresrpg/immutable'
import { ArrowLeft, Hammer, Shield, Sparkles, Swords, Wheat } from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'

import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'
import { Empty, SearchField } from './components.tsx'
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
    <aside className="flex w-[300px] min-w-[300px] flex-col border-r border-[#1e1e2e] max-[760px]:w-full max-[760px]:min-w-0 max-[760px]:border-r-0">
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
              <div className="flex items-center gap-2 border-b border-[#1e1e2e] bg-white/2 px-3 py-2">
                <Icon className="text-[#c8963c] opacity-50" size={10} />
                <span className="text-[8px] font-semibold tracking-[0.2em] text-[#c8963c]/70 uppercase">
                  {text(`job_category.${group}`)}
                </span>
              </div>
              {rows.map((job) => {
                const active = selected_id === job.id
                return (
                  <button
                    className={`flex w-full cursor-pointer flex-col border-b border-l-2 border-b-[#1e1e2e]/50 px-3 py-2.5 text-left transition-colors ${
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

  const job_detail = (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-6 max-[760px]:p-3">
      {!detail || !category ? (
        <Empty>
          <Hammer className="opacity-20" size={24} />
          {text('select_job')}
        </Empty>
      ) : (
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
                <div className="flex items-center border-b border-[#1e1e2e] bg-white/3 px-2 py-1.5">
                  <span className="w-12 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">{text('tier')}</span>
                  <span className="w-16 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
                    {text('required_level')}
                  </span>
                  <span className="flex-1 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
                    {text('resource')}
                  </span>
                  <span className="flex-1 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
                    {text('rare_variant')}
                  </span>
                  <span className="w-16 text-right text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
                    {text('xp_per_harvest')}
                  </span>
                </div>
                {detail.resources
                  .toSorted((left, right) => left.row.tier - right.row.tier)
                  .map(({ row, required_level }) => {
                    const resource = encyclopedia_catalog.item(row.item_type)?.item
                    const rare = row.rare_item_type ? encyclopedia_catalog.item(row.rare_item_type)?.item : null
                    return (
                      <button
                        className="flex cursor-pointer items-center border-b border-[#1e1e2e]/30 px-2 py-1.5 text-left hover:bg-white/2"
                        key={row.item_type}
                        onClick={() => select_item(row.item_type)}
                        type="button"
                      >
                        <span className="w-12 text-[9px] text-[#c8963c]/70">T{row.tier}</span>
                        <span className="w-16 text-[9px] text-[#6b7280]">
                          {text('level')} {required_level}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {item_icon(row.item_type) && (
                            <img alt="" className="size-4 object-contain" src={item_icon(row.item_type)!} />
                          )}
                          <span className="truncate text-[9px] text-[#e8e4dc]">
                            {resource?.name ?? titleize(row.item_type)}
                          </span>
                        </span>
                        {rare ? (
                          <span
                            className="flex min-w-0 flex-1 items-center gap-2"
                            onClick={(event) => {
                              event.stopPropagation()
                              select_item(rare.item_type)
                            }}
                          >
                            {item_icon(rare.item_type) && (
                              <img alt="" className="size-4 object-contain" src={item_icon(rare.item_type)!} />
                            )}
                            <span className="truncate text-[9px] text-[#c8963c]">{rare.name}</span>
                          </span>
                        ) : (
                          <span className="flex-1 text-[9px] text-[#6b7280]/50">—</span>
                        )}
                        <span className="w-16 text-right text-[9px] text-[#4a9eff]">
                          {10 + Math.floor(required_level / 2)} XP
                        </span>
                      </button>
                    )
                  })}
              </div>
            </section>
          )}

          <JobRecipesSection recipes={detail.recipes} select_item={select_item} text={text} />
        </div>
      )}
    </div>
  )

  if (selected_id)
    return (
      <div className="flex min-h-0 flex-1 max-[760px]:flex-col">
        <button
          className="hidden items-center gap-2 border-b border-[#1e1e2e] px-3 py-2 text-[10px] tracking-[0.15em] text-[#6b7280] uppercase max-[760px]:flex"
          onClick={() => select_job('')}
          type="button"
        >
          <ArrowLeft size={12} /> {text('back_to_list')}
        </button>
        <div className="max-[760px]:hidden">{job_list}</div>
        {job_detail}
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1">
      {job_list}
      <div className="max-[760px]:hidden">{job_detail}</div>
    </div>
  )
}
