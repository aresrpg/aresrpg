// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// JOBS — the canon professions drawer, markup and classes ported from the proven Jobs panel
// (jobs.css, verbatim): the LEFT rail groups the 11 jobs by category with per-job level
// chips (job xp is chain truth on the CharacterRow); the RIGHT detail shows the job head +
// xp bar, the gathering 11-tier resource table, and ALL recipes grouped Unlocked/Locked.
// Clicking a resource or recipe opens the shared ItemDetailView in the right-section — and
// a craftable recipe renders the inline bill of materials (GREEN/ORANGE owned rows) + the
// REAL Craft button: one terminal transaction through the SDK, the same two gates the chain
// asserts (job level + affordability), the roll reported honestly off the Crafted event.

import { useMemo, useState, type ReactNode } from 'react'
import {
  craft_batch_limit,
  craft_required_level,
  craft_success_percent,
  gather_quantity_bounds,
  gather_xp,
  item_is_stackable,
  job_groups,
  job_level_from_xp,
  job_max_level,
  job_xp_for_level,
  type JobKind,
  type JobSlug,
} from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { ArrowRightLeft, X } from 'lucide-react'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize, type SeedRecipe } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import {
  available_item_stacks,
  coalesced_stack_groups,
  craft_output_stack_plan,
  craft_stack_plan,
  encumbered_asset_ids,
} from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { retry_after_version_race, run_direct_transaction } from '../transaction_guard.ts'

import './jobs.css'
import './jobs_adviser.css'

const CATEGORY_ORDER = Object.freeze(Object.keys(job_groups) as JobKind[])
const JOBS = Object.freeze(CATEGORY_ORDER.flatMap((kind) => job_groups[kind]))
const CATEGORY_LABEL_KEY: Readonly<Record<JobKind, string>> = Object.freeze({
  gathering: 'jobs.category.gathering',
  weapon_craft: 'jobs.category.weapon',
  equipment_craft: 'jobs.category.equipment',
  consumable_craft: 'jobs.category.consumable',
})

/** Per-category accent glyph — the canon inline SVG paths (jobs_visuals). */
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

/** The drawer's item icon — real art with the canon diamond-glyph fallback. */
const JobItemIcon = ({ icon, size = 28 }: Readonly<{ icon: string; size?: number }>) => {
  const url = item_icon(icon)
  if (!url)
    return (
      <span aria-hidden="true" className="jobs__item-glyph" style={{ width: size, height: size }}>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M12 3 21 12 12 21 3 12Z" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
      </span>
    )
  return <img alt="" className="jobs__item-img" height={size} loading="lazy" src={url} width={size} />
}

const covers_label = (job: JobSlug): string => {
  const detail = encyclopedia_catalog.job(job)
  const item_types =
    detail && detail.resources.length > 0
      ? detail.resources.map(({ row }) => row.item_type)
      : (detail?.recipes.map((row) => row.output_type) ?? [])
  const categories = [
    ...new Set(item_types.map((item_type) => encyclopedia_catalog.item(item_type)?.item.category).filter(Boolean)),
  ]
  return categories.map((category) => titleize(category!)).join(', ')
}

const recipe_required_level = (recipe: Readonly<SeedRecipe>): number =>
  craft_required_level(Object.keys(recipe.inputs).length)

const kind_of = (job: JobSlug): JobKind =>
  (Object.entries(job_groups) as readonly (readonly [JobKind, readonly JobSlug[]])[]).find(([, jobs]) =>
    jobs.includes(job)
  )![0]

export const job_from_path = (pathname: string): JobSlug => {
  const selected = new URLSearchParams(pathname.split('?')[1]?.split('#')[0] ?? '').get('job')
  return selected && JOBS.includes(selected as JobSlug) ? (selected as JobSlug) : 'FARMER'
}

export const job_path = (job: JobSlug): string => `/characters/jobs?job=${encodeURIComponent(job)}`

export const craft_result_tone = (successes: number): 'error' | 'success' => (successes === 0 ? 'error' : 'success')

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

/** Inline craft controls — the bill of materials + the real Craft button, as detail children. */
const CraftControls = ({
  recipe,
  character,
  job,
  level,
  t,
}: Readonly<{
  recipe: Readonly<SeedRecipe>
  character: Readonly<CharacterRow>
  job: JobSlug
  level: number
  t: CopyText
}>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  const inventory = useAppStore(({ session }) => session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const encumbered = encumbered_asset_ids(listings, trades)
  const [pending, set_pending] = useState(false)
  const [attempts, set_attempts] = useState(1)
  const output = encyclopedia_catalog.item(recipe.output_type)!.item
  const stackable_output = item_is_stackable(output.category)
  const batch_limit = craft_batch_limit(output.category)
  const stack_plan = craft_stack_plan(recipe.inputs, attempts, inventory, encumbered, character.kiosk)

  const rows = Object.entries(recipe.inputs).map(([item_type, per_attempt]) => {
    const stacks = available_item_stacks(inventory, encumbered, item_type, character.kiosk)
    const need = per_attempt * attempts
    return {
      item_type,
      need,
      have: stacks.reduce((total, stack) => total + stack.amount, 0),
      enough: stacks.reduce((total, stack) => total + stack.amount, 0) >= need,
    }
  })
  const required = recipe_required_level(recipe)
  const level_ok = level >= required
  const affordable = stack_plan !== null
  const can_craft = !!wallet && level_ok && affordable && !pending
  const success_chance = craft_success_percent(level)

  const on_craft = (): void => {
    if (!can_craft || !wallet || !stack_plan) return
    const input_ids = new Set(stack_plan.flatMap(({ target_id, source_ids }) => [target_id, ...source_ids]))
    const output_plan = craft_output_stack_plan(
      inventory,
      encumbered,
      recipe.output_type,
      character.kiosk,
      attempts,
      input_ids
    )
    const merge_groups = coalesced_stack_groups(inventory, encumbered)
      .filter(({ target }) => target.kiosk === character.kiosk)
      .map(({ target, source_ids }) => ({ kiosk: target.kiosk, target_id: target.id, source_ids }))
    const transaction = run_direct_transaction(() =>
      retry_after_version_race(() => wallet.stacks.merge_many(merge_groups)).then(() => {
        dispatch_app({ type: 'inventory/stacks_merged', groups: merge_groups })
        return retry_after_version_race(() =>
          wallet.character.craft({
            character_id: character.id,
            output_type: recipe.output_type,
            input_item_ids: stack_plan.map(({ target_id }) => target_id),
            existing: output_plan?.target_id ?? null,
            attempts,
            custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
          })
        )
      })
    )
    if (!transaction) return
    set_pending(true)
    const { name } = output
    const pending_toast = toast.loading(t('jobs.craft.prepare_tooltip', { count: attempts, name }))
    void transaction
      .then(({ attempts: completed_attempts, successes, job_xp_gained }) => {
        dispatch_app({
          type: 'character/crafted',
          character_id: character.id,
          job,
          xp: job_xp_gained,
          inputs: stack_plan.map(({ target_id, amount }) => ({ item_id: target_id, amount })),
        })
        const message = t('jobs.craft.craft_result', { attempts: completed_attempts, successes, name })
        if (craft_result_tone(successes) === 'error') pending_toast.error(message)
        else pending_toast.success(message)
      })
      .catch(pending_toast.error)
      .finally(() => set_pending(false))
  }

  return (
    <div className="jobs__craft">
      <div className="jobs__craft-head">{t('jobs.craft.ingredients_head')}</div>
      <div className="jobs__ingredients">
        {rows.map(({ item_type, need, have, enough }) => {
          const seed = encyclopedia_catalog.item(item_type)?.item
          return (
            <div className="jobs__ingredient" key={item_type}>
              <JobItemIcon icon={item_type} size={32} />
              <span className="jobs__ingredient-id">
                <span className="jobs__ingredient-name">{seed?.name ?? titleize(item_type)}</span>
                <span className="jobs__ingredient-lvl hud-num">{t('jobs.lv_badge', { level: seed?.level ?? 1 })}</span>
              </span>
              <span className={`jobs__ingredient-amt hud-num ${enough ? 'is-enough' : 'is-short'}`}>
                {have} / {need}
              </span>
            </div>
          )
        })}
      </div>

      <div className="jobs__craft-chance">
        <span className="jobs__craft-chance-label">{t('jobs.craft.starting_chance')}</span>
        <span className="jobs__craft-chance-value hud-num">{success_chance}%</span>
      </div>

      <div className="jobs__craft-bar" data-stackable-output={String(stackable_output)}>
        <label className="jobs__craft-amount" hidden={!stackable_output}>
          <span className="jobs__craft-amount-label">{t('jobs.craft.amount')}</span>
          <input
            aria-label={t('jobs.craft.amount')}
            className="jobs__craft-input hud-num"
            disabled={pending}
            max={batch_limit}
            min={1}
            onChange={({ currentTarget }) =>
              set_attempts(Math.max(1, Math.min(batch_limit, Math.floor(Number(currentTarget.value)))))
            }
            type="number"
            value={attempts}
          />
        </label>
        <button
          className="btn-gold jobs__craft-btn"
          disabled={!can_craft}
          onClick={on_craft}
          title={
            !level_ok
              ? t('jobs.craft.requires_level', { job: titleize(job), required, level })
              : !affordable
                ? t('jobs.craft.not_enough')
                : t('jobs.craft.craft_tooltip', {
                    count: attempts,
                    name: output.name,
                  })
          }
          type="button"
        >
          {pending
            ? t('jobs.craft.crafting')
            : level_ok
              ? t('jobs.craft.craft_button', { count: attempts })
              : t('jobs.craft.locked_level', { level: required })}
        </button>
      </div>
    </div>
  )
}

export default function JobsTab({ character, copy }: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) {
  const t = copy_text(copy.characters_page)
  const encyclopedia = encyclopedia_text(copy)
  const characters = useAppStore(({ session }) => session.characters)
  const crafting_locked = useAppStore(({ settings }) => !!settings.always_craft_from_character_id)
  const pathname = useAppStore(({ navigation }) => navigation.pathname)
  const [selected_job, set_selected_job] = useState<JobSlug>(() => job_from_path(pathname))
  const [selected, set_selected] = useState<Readonly<{ item_type: string; recipe: SeedRecipe | null }> | null>(null)

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

  const selected_seed = selected ? (encyclopedia_catalog.item(selected.item_type)?.item ?? null) : null
  const { unlocked, locked } = useMemo(() => {
    const rows = detail?.recipes ?? []
    return {
      unlocked: rows.filter((recipe) => level >= recipe_required_level(recipe)),
      locked: rows.filter((recipe) => level < recipe_required_level(recipe)),
    }
  }, [detail, level])

  const recipe_cell = (recipe: Readonly<SeedRecipe>, is_locked: boolean): ReactNode => {
    const output = encyclopedia_catalog.item(recipe.output_type)?.item
    return (
      <button
        className={`jobs__recipe${is_locked ? ' is-locked' : ''}${recipe.output_type === selected?.item_type ? ' is-selected' : ''}`}
        key={recipe.output_type}
        onClick={() => set_selected({ item_type: recipe.output_type, recipe })}
        type="button"
      >
        <JobItemIcon icon={recipe.output_type} size={32} />
        <span className="jobs__recipe-id">
          <span className="jobs__recipe-name">{output?.name ?? titleize(recipe.output_type)}</span>
          <span className="jobs__recipe-meta hud-num">
            {t('jobs.lv_badge', { level: recipe_required_level(recipe) })} · {titleize(output?.category ?? '')}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="jobs" data-tutorial-target="character_jobs">
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
                            job: titleize(job),
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
                      set_selected(null)
                      dispatch_app({ type: 'path/open', pathname: job_path(job) })
                    }}
                    type="button"
                  >
                    <span className="jobs__list-id">
                      <span className="jobs__list-name">{titleize(job)}</span>
                      <span className="jobs__list-sub">{covers_label(job) || t('jobs.recipes_fallback')}</span>
                    </span>
                    {active_job_id === job && <span className="jobs__list-tag">{t('jobs.equipped')}</span>}
                    <span className="jobs__list-lvl hud-num">{level_of(job)}</span>
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* RIGHT detail — header + xp bar + stacked Resources/Recipes sections */}
      <div className="jobs__detail">
        <div className="jobs__detail-head">
          <div aria-hidden="true" className="jobs__icon">
            <JobGlyph kind={kind_of(selected_job)} />
          </div>
          <div className="jobs__detail-id">
            <div className="jobs__detail-title-row">
              <span className="jobs__detail-name">{titleize(selected_job)}</span>
              {active_job_id === selected_job && <span className="jobs__list-tag">{t('jobs.equipped')}</span>}
            </div>
            <span className="jobs__detail-sub">
              {t('jobs.detail.crafts_label', { covers: covers_label(selected_job) })}
            </span>
          </div>
          <span className="jobs__detail-lvl hud-num">{t('jobs.lv_badge', { level })}</span>
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
        <div className={`jobs__browse-area${selected ? ' has-detail' : ''}`}>
          <div className="jobs__browse">
            {is_gathering && detail && detail.resources.length > 0 && (
              <>
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
                          className={`jobs__table-row${is_locked ? ' is-locked' : ''}${row.item_type === selected?.item_type ? ' is-selected' : ''}`}
                          key={row.item_type}
                          onClick={() => set_selected({ item_type: row.item_type, recipe: null })}
                          type="button"
                        >
                          <span className="jobs__col-tier hud-num">{t('jobs.tier_badge', { tier: row.tier })}</span>
                          <span className="jobs__col-req hud-num">{t('jobs.lv_badge', { level: required_level })}</span>
                          <span className="jobs__col-name">
                            <JobItemIcon icon={row.item_type} />
                            {seed?.name ?? titleize(row.item_type)}
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
              </>
            )}

            <div className="jobs__section-head">
              <span>{t('jobs.recipes_fallback')}</span>
            </div>
            {!detail || detail.recipes.length === 0 ? (
              <div className="jobs__recipe-empty">{t('jobs.recipes.empty_seed')}</div>
            ) : (
              <div className="jobs__recipes">
                {unlocked.length > 0 && (
                  <div className="jobs__recipe-block">
                    <div className="jobs__recipe-block-head">
                      {t('jobs.recipes.unlocked')} <span className="hud-num">({unlocked.length})</span>
                    </div>
                    <div className="jobs__recipe-grid">{unlocked.map((recipe) => recipe_cell(recipe, false))}</div>
                  </div>
                )}
                {locked.length > 0 && (
                  <div className="jobs__recipe-block">
                    <div className="jobs__recipe-block-head is-locked">
                      {t('jobs.recipes.locked')} <span className="hud-num">({locked.length})</span>
                    </div>
                    <div className="jobs__recipe-grid">{locked.map((recipe) => recipe_cell(recipe, true))}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {selected && (
            <div className="jobs__item-detail">
              <button
                aria-label={t('jobs.detail.close_aria')}
                className="jobs__item-close"
                onClick={() => set_selected(null)}
                type="button"
              >
                <X size={13} />
              </button>
              {selected_seed ? (
                <ItemDetailView
                  category={selected_seed.category}
                  damages={(selected_seed.damages ?? []).map((line) => ({ ...line }))}
                  item_type={selected_seed.item_type}
                  labels={{
                    characteristics: encyclopedia('characteristics'),
                    damages: encyclopedia('damages'),
                    level_short: encyclopedia('level_short', { level: selected_seed.level }),
                    range_to: encyclopedia('range_to'),
                  }}
                  level={selected_seed.level}
                  name={selected_seed.name}
                  stats={selected_seed.stats}
                >
                  {selected.recipe && (
                    <CraftControls
                      character={character}
                      job={selected_job}
                      key={selected.recipe.output_type}
                      level={level}
                      recipe={selected.recipe}
                      t={t}
                    />
                  )}
                </ItemDetailView>
              ) : (
                <div className="jobs__recipe-empty">{t('jobs.detail.item_not_seeded')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
