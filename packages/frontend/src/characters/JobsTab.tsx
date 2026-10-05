// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Jobs drawer: chain-owned levels, gathering rows, recipes, ingredient navigation, and crafting.

import { CollectionTile } from '@aresrpg/ui'
import {
  craft_required_level,
  gather_quantity_bounds,
  gather_xp,
  job_groups,
  job_level_from_xp,
  job_max_level,
  job_xp_for_level,
  type JobKind,
  type JobSlug,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { ArrowRightLeft } from 'lucide-react'
import { useMemo, useState, useRef, type ComponentProps, type ReactNode } from 'react'

import { item_icon } from '../content/assets.ts'
import { useInspections } from '../components/useInspections.ts'
import { ItemDetailView, InspectionWindow } from '../components/ItemDetailView.tsx'
import { encyclopedia_catalog, titleize, type SeedRecipe } from '../content/catalog.ts'
import { ConsumableEffectSection } from '../encyclopedia/ConsumableEffectSection.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { GatheringTime } from './GatheringTime.tsx'
import { job_from_path, job_path } from './job_navigation.ts'
import { JobEmblem } from './JobEmblem.tsx'
import { JobItemIcon } from './JobItemIcon.tsx'

import './jobs.css'
import './jobs_adviser.css'
import './jobs_recipe_sections.css'
const CATEGORY_ORDER = Object.freeze(Object.keys(job_groups) as JobKind[])
const CATEGORY_LABEL_KEY: Readonly<Record<JobKind, string>> = Object.freeze({
  gathering: 'jobs.category.gathering',
  weapon_craft: 'jobs.category.weapon',
  equipment_craft: 'jobs.category.equipment',
  consumable_craft: 'jobs.category.consumable',
})
const CATEGORY_GLYPH: Readonly<Record<JobKind, ReactNode>> = Object.freeze({
  gathering: <path d="M2 22 16 8M17 7l5-5M14 4l6 6M9 9l4 4" />,
  weapon_craft: <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4" />,
  equipment_craft: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  consumable_craft: <path d="M5 3h14l-1 7a6 6 0 0 1-12 0zM12 17v4M8 21h8" />,
})
const JobGlyph = ({ kind }: Readonly<{ kind: JobKind }>) => (
  <svg
    aria-hidden="true"
    className="jobs__glyph"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
  >
    {CATEGORY_GLYPH[kind]}
  </svg>
)
const covers_label = (copy: AppCopy, kind: JobKind): string =>
  ({
    gathering: copy_text(copy.characters_page)('bag_resources'),
    weapon_craft: encyclopedia_text(copy)('group_weapons'),
    equipment_craft: copy_text(copy.characters_page)('bag_equipment'),
    consumable_craft: copy_text(copy.characters_page)('bag_consumables'),
  })[kind]

const JobRecipeDetails = ({
  id,
  copy,
  craft_session,
}: Readonly<{ id: string; copy: AppCopy; craft_session: ComponentProps<typeof ItemDetailView>['craft_session'] }>) => {
  const item = encyclopedia_catalog.item(id)?.item
  const text = encyclopedia_text(copy)
  if (!item) return null
  return (
    <ItemDetailView
      {...item}
      damages={item.damages ?? []}
      craft_session={craft_session}
      labels={{
        characteristics: text('characteristics'),
        damages: text('damages'),
        level_short: text('level_short', { level: item.level }),
        range_to: text('range_to'),
      }}
    >
      <ConsumableEffectSection consumable={item.consumable} text={text} />
    </ItemDetailView>
  )
}
const recipe_card_class = (locked: boolean, selected: boolean, best: boolean): string =>
  `jobs__recipe${locked ? ' is-locked' : ''}${selected ? ' is-selected' : ''}${best ? ' is-best-progress' : ''}`

export const recipe_tiers = (recipes: readonly Readonly<SeedRecipe>[]) => {
  const tiers = new Map<number, Readonly<SeedRecipe>[]>()
  for (const recipe of recipes) {
    const ingredient_count = Object.keys(recipe.inputs).length
    tiers.set(ingredient_count, [...(tiers.get(ingredient_count) ?? []), recipe])
  }
  return Object.freeze(
    [...tiers.entries()]
      .sort(([left], [right]) => left - right)
      .map(([ingredient_count, rows]) =>
        Object.freeze({ ingredient_count, required_level: craft_required_level(ingredient_count), recipes: rows })
      )
  )
}
const kind_of = (job: JobSlug): JobKind =>
  (Object.entries(job_groups) as readonly (readonly [JobKind, readonly JobSlug[]])[]).find(([, jobs]) =>
    jobs.includes(job)
  )![0]

export const better_job_character = (
  characters: readonly Pick<CharacterRow, 'id' | 'name' | 'jobs'>[],
  current_character_id: string,
  job: JobSlug
): Readonly<{ id: string; name: string; level: number }> | null => {
  const current = characters.find(({ id }) => id === current_character_id)
  const current_level = job_level_from_xp(Number(current?.jobs[job] ?? 0))
  return characters.reduce<Readonly<{ id: string; name: string; level: number }> | null>((best, candidate) => {
    if (candidate.id === current_character_id) return best
    const level = job_level_from_xp(Number(candidate.jobs[job] ?? 0))
    if (level <= current_level || (best && best.level >= level)) return best
    return Object.freeze({ id: candidate.id, name: candidate.name, level })
  }, null)
}

const useJobSession = (preview: boolean | undefined, character: Readonly<CharacterRow>) => {
  const live = useAppStore((state) => state.session.characters)
  return {
    characters: preview ? [character] : live,
    craft_session: { character, inventory: preview ? [] : undefined },
  }
}

export default function JobsTab({
  character,
  copy,
  preview,
  navigate_job,
}: Readonly<{
  character: Readonly<CharacterRow>
  copy: AppCopy
  preview?: boolean
  navigate_job?: (pathname: string) => void
}>) {
  const vocabulary = useVocabulary()
  const t = copy_text(copy.characters_page)
  const encyclopedia = encyclopedia_text(copy)
  const { characters, craft_session } = useJobSession(preview, character)
  const crafting_locked = useAppStore(({ settings }) => !!settings.always_craft_from_character_id)
  const pathname = useAppStore(({ navigation }) => navigation.pathname)
  const [selected_job, set_selected_job] = useState<JobSlug>(() => job_from_path(pathname))
  const root = useRef<HTMLDivElement>(null)
  const { inspections, open, close } = useInspections(root)
  const selected = inspections.at(-1)?.id ?? null

  const xp_of = (job: JobSlug): number => Number(character.jobs[job] ?? 0)
  const level_of = (job: JobSlug): number => job_level_from_xp(xp_of(job))
  // the active gathering job = the one whose tool is equipped
  const equipped_tool = character.equipment.find(({ slot }) => slot === 'tool')
  const active_job_id = equipped_tool
    ? (`${equipped_tool.category.replace('tool_', '').toUpperCase()}` as JobSlug)
    : null

  const detail = encyclopedia_catalog.job(selected_job)
  const level = level_of(selected_job)
  const xp = xp_of(selected_job)
  const floor = job_xp_for_level(level) ?? 0
  const ceiling = level >= job_max_level ? floor : (job_xp_for_level(level + 1) ?? floor)
  const span = Math.max(0, ceiling - floor)
  const into = Math.max(0, xp - floor)
  const pct = span > 0 ? Math.max(0, Math.min(100, (into / span) * 100)) : 100
  const is_gathering = kind_of(selected_job) === 'gathering'

  const { unlocked, locked } = useMemo(() => {
    const rows = detail?.recipes ?? []
    return {
      unlocked: rows.filter((recipe) => level >= craft_required_level(Object.keys(recipe.inputs).length)),
      locked: rows.filter((recipe) => level < craft_required_level(Object.keys(recipe.inputs).length)),
    }
  }, [detail, level])
  const best_progress = useMemo(() => encyclopedia_catalog.progress_recipe(selected_job, level), [level, selected_job])
  const recipe_sections = [
    { id: 'unlocked', rows: unlocked, groups: recipe_tiers(unlocked), locked: false },
    { id: 'locked', rows: locked, groups: recipe_tiers(locked), locked: true },
  ].filter(({ rows }) => rows.length > 0)

  const recipe_cell = (recipe: Readonly<SeedRecipe>, is_locked: boolean): ReactNode => {
    const output = encyclopedia_catalog.item(recipe.output_type)?.item
    const is_best_progress = recipe.output_type === best_progress?.output_type
    return (
      <CollectionTile
        className={recipe_card_class(is_locked, recipe.output_type === selected, is_best_progress)}
        selected={recipe.output_type === selected}
        on_select={() => open('item')(recipe.output_type)}
        key={recipe.output_type}
        entry={{
          id: recipe.output_type,
          label: output?.name ?? titleize(recipe.output_type),
          image: item_icon(recipe.output_type) ?? undefined,
          meta: `${t('jobs.lv_badge', { level: craft_required_level(Object.keys(recipe.inputs).length) })} · ${t('jobs.recipes.ingredients', { count: Object.keys(recipe.inputs).length })}`,
          badge: is_best_progress ? t('jobs.recipes.best_progress') : undefined,
          muted: is_locked,
        }}
      />
    )
  }

  return (
    <div ref={root} className="jobs" data-tutorial-target="character_jobs">
      {/* LEFT rail — jobs grouped by category, each a selectable row with a level chip */}
      <div className="jobs__list">
        {CATEGORY_ORDER.map((kind) => (
          <div className="jobs__list-group" key={kind}>
            <div className="jobs__list-head">
              <span aria-hidden="true" className="jobs__list-glyph">
                <JobGlyph kind={kind} />
              </span>
              {t(CATEGORY_LABEL_KEY[kind])}
            </div>
            <div className="jobs__list-entries">
              {job_groups[kind].map((job) => {
                const better = crafting_locked ? null : better_job_character(characters, character.id, job)
                return (
                  <div className="jobs__list-entry" key={job}>
                    <div className="jobs__alternate-slot">
                      {better && (
                        <aside className="jobs__alternate" data-better-job-character={better.id}>
                          <span>
                            {t('jobs.better_character', {
                              name: better.name,
                              job: vocabulary.job(job),
                              level: better.level,
                            })}
                          </span>
                          <button
                            aria-label={t('jobs.switch_to_character', { name: better.name })}
                            onClick={() => dispatch_app({ type: 'character/select', character_id: better.id })}
                            title={t('jobs.switch_to_character', { name: better.name })}
                            type="button"
                          >
                            <ArrowRightLeft aria-hidden="true" size={10} />
                            {t('jobs.switch')}
                          </button>
                        </aside>
                      )}
                    </div>
                    <button
                      className={`jobs__list-row${selected_job === job ? ' is-selected' : ''}`}
                      onClick={() => {
                        set_selected_job(job)
                        navigate_job?.(job_path(job))
                      }}
                      type="button"
                    >
                      <JobEmblem job={job} />
                      <span className="jobs__list-id">
                        <span className="jobs__list-name">{vocabulary.job(job)}</span>
                        <span className="jobs__list-sub">{covers_label(copy, kind)}</span>
                      </span>
                      {active_job_id === job && <span className="jobs__list-tag">{t('jobs.equipped')}</span>}
                      <span className="jobs__list-lvl hud-num">{t('jobs.lv_badge', { level: level_of(job) })}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* RIGHT detail — header + xp bar + stacked Resources/Recipes sections */}
      <div className="jobs__detail">
        <div className="jobs__detail-head">
          <div aria-hidden="true" className="jobs__icon">
            <JobEmblem job={selected_job} />
          </div>
          <div className="jobs__detail-id">
            <div className="jobs__detail-title-row">
              <span className="jobs__detail-name">{vocabulary.job(selected_job)}</span>
              {active_job_id === selected_job && <span className="jobs__list-tag">{t('jobs.equipped')}</span>}
            </div>
            <span className="jobs__detail-sub">
              {t('jobs.detail.crafts_label', { covers: covers_label(copy, kind_of(selected_job)) })}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="hud-num text-sm text-text">{t('jobs.lv_badge', { level })}</span>
            <GatheringTime gathering={is_gathering} level={level} t={t} />
          </div>
        </div>

        <div
          className="jobs__xp"
          title={t('jobs.detail.xp_progress', { current: into, needed: span > 0 ? span : t('common.max') })}
        >
          <div className="jobs__xp-fill" style={{ width: `${pct}%` }} />
          <span className="jobs__xp-num hud-num">
            {span > 0 ? t('jobs.detail.xp_progress', { current: into, needed: span }) : t('common.max')}
          </span>
        </div>

        {/* browse collapses beside an open item detail (the encyclopedia right-section pattern) */}
        <div className="jobs__browse-area">
          <div className="jobs__browse">
            {is_gathering && detail && detail.resources.length > 0 && (
              <section className="jobs__gather-section">
                <div className="jobs__section-head">
                  <span>{t('jobs.table.resource')}</span>
                </div>
                <div className="jobs__table">
                  <div className="jobs__table-head">
                    <span className="jobs__col-tier">{t('jobs.table.tier')}</span>
                    <span className="jobs__col-req">{t('jobs.table.req_lvl')}</span>
                    <span className="jobs__col-name">{t('jobs.table.resource')}</span>
                    <span className="jobs__col-yield">{t('jobs.table.yield')}</span>
                    <span className="jobs__col-xp">{t('jobs.table.xp')}</span>
                  </div>
                  <div className="jobs__gather-rows">
                    {detail.resources
                      .toSorted((left, right) => left.row.tier - right.row.tier)
                      .map(({ row, required_level }) => {
                        const seed = encyclopedia_catalog.item(row.item_type)?.item
                        const is_locked = level < required_level
                        const [min_yield, max_yield] = gather_quantity_bounds(
                          Math.max(level, required_level),
                          required_level
                        )
                        return (
                          <button
                            className={`jobs__table-row${is_locked ? ' is-locked' : ''}${row.item_type === selected ? ' is-selected' : ''}`}
                            key={row.item_type}
                            onClick={() => open('item')(row.item_type)}
                            type="button"
                          >
                            <span className="jobs__col-tier hud-num">{t('jobs.tier_badge', { tier: row.tier })}</span>
                            <span className="jobs__col-req hud-num">
                              {t('jobs.lv_badge', { level: required_level })}
                            </span>
                            <span className="jobs__col-name">
                              <JobItemIcon icon={row.item_type} />
                              <span>{seed?.name ?? titleize(row.item_type)}</span>
                            </span>
                            <span className="jobs__col-yield hud-num">
                              {is_locked ? '-' : `${min_yield}–${max_yield}`}
                            </span>
                            <span className="jobs__col-xp hud-num">
                              {is_locked ? '-' : `+${gather_xp(required_level)}`}
                            </span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              </section>
            )}

            <section className="jobs__recipes-section">
              <div className="jobs__section-head">
                <span>{t('jobs.recipes_fallback')}</span>
              </div>
              {!detail || detail.recipes.length === 0 ? (
                <div className="jobs__recipe-empty">{t('jobs.recipes.empty_seed')}</div>
              ) : (
                <div className="jobs__recipe-sections">
                  {recipe_sections.map((section) => (
                    <section
                      className="jobs__recipe-section"
                      aria-label={t(`jobs.recipes.${section.id}`)}
                      key={section.id}
                    >
                      <h4>{t(`jobs.recipes.${section.id}`)}</h4>
                      <div className="jobs__recipes jobs__recipe-grid aui-collection aui-collection--rows">
                        {section.groups.flatMap((group) =>
                          group.recipes.map((recipe) => recipe_cell(recipe, section.locked))
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
      {inspections.map((entry) => (
        <InspectionWindow
          key={`${entry.kind}:${entry.id}`}
          entry={entry}
          open={open}
          close={() => close(entry)}
          props={{
            craft_session,
            labels: {
              characteristics: encyclopedia('characteristics'),
              damages: encyclopedia('damages'),
              level_short: '',
              range_to: encyclopedia('range_to'),
            },
          }}
          render_item={(id) => <JobRecipeDetails id={id} copy={copy} craft_session={craft_session} />}
        />
      ))}
    </div>
  )
}
