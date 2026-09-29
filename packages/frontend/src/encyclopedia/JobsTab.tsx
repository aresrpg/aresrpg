// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Collection } from '@aresrpg/ui'
import { job_groups, job_kind_of, type JobKind } from '@aresrpg/immutable'
import { Hammer, Shield, Sparkles, Swords, Wheat } from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'

import { JobEmblem } from '../characters/JobEmblem.tsx'
import { Text } from '../i18n/Text.tsx'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
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

const job_crafts = (category_name: (category: string) => string, job: Job): string => {
  const item_types =
    job.resources.length > 0 ? job.resources.map(({ row }) => row.item_type) : job.recipes.map((row) => row.output_type)
  const categories = [
    ...new Set(item_types.map((item_type) => encyclopedia_catalog.item(item_type)?.item.category).filter(Boolean)),
  ]
  return categories.map((category) => category_name(category!)).join(', ')
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
  const vocabulary = useVocabulary()
  const category_name = useItemCategoryName()
  const [search, set_search] = useState('')
  const jobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return encyclopedia_catalog.jobs.filter(
      (job) =>
        !query ||
        vocabulary.job(job.id).toLowerCase().includes(query) ||
        job_category(job).includes(query) ||
        job_crafts(category_name, job).toLowerCase().includes(query)
    )
  }, [search, vocabulary, category_name])
  const detail = selected_id ? encyclopedia_catalog.job(selected_id) : null
  const category = detail ? job_category(detail) : null
  const CategoryIcon = category ? JOB_ICONS[category] : Hammer

  const job_list = (
    <div className="enc-browser__list aui-catalogue-browser">
      <div className="aui-catalogue-tools">
        <SearchField value={search} change={set_search} placeholder={text('search_jobs')} />
      </div>
      <Collection
        label={text('jobs_tab')}
        selected={selected_id}
        select={select_job}
        entries={jobs.map((job) => ({
          id: job.id,
          label: vocabulary.job(job.id),
          icon: <JobEmblem job={job.id} />,
          meta: job_crafts(category_name, job),
        }))}
      />
    </div>
  )

  const job_detail = detail && category && (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-6">
      <div className="flex w-full flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <CategoryIcon className="text-[#c8963c]" size={18} />
            <h2 className="text-[16px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
              {vocabulary.job(detail.id)}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="border border-[#c8963c]/30 px-2 py-0.5 text-[8px] tracking-[0.15em] text-[#c8963c]/70 uppercase">
              {text(`job_category.${category}`)}
            </span>
            <span className="text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
              {text('crafts')}: {job_crafts(category_name, detail) || '—'}
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
                        <span className="enc-gather-label">{text('tier')}</span>
                        <Text path="encyclopedia_page.world_resource_tier" values={{ tier: row.tier }} />
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
                        {10 + Math.floor(required_level / 2)} <Text path="ui.xp" />
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
