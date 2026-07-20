// RECIPE + INGREDIENT OF item-detail sections — sourced from the ON-CHAIN `crafting::Recipe` objects via
// /v1/encyclopedia?kind=recipes (the indexer object-snapshots each shared Recipe: rpc:recipe:{id}), NOT the
// static @aresrpg/sdk seed catalog. Every value shown is the chain's own: the exact ingredient list +
// quantities, the output quantity, the required job + knowledge level, and the per-craft XP — so a recipe in
// the encyclopedia is provably a real on-chain recipe with these exact numbers: if it's in the
// encyclopedia, players are 100% sure it's in game. Join key is the on-chain ItemTemplate id (recipe
// `output_template_id`/`inputs[].template_id` ↔ the /v1 item `template_id` the encyclopedia routes on) — never
// a seed slug, so a seed row that never minted can never surface. An ingredient/output whose template isn't a
// live encyclopedia item renders as a plain (non-navigable) short id — the honest gap, never fabricated.
// Structure (which recipe / which rows / exact numbers) lives in the pure recipes.ts module (unit-tested);
// this component only resolves display names (i18n tt) and renders.
import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { JOBS } from '@aresrpg/sdk/jobs'

import { SectionDivider } from '../../components/entity_display'
import { use_template_t } from '../../i18n/template_t'
import type { RpcRecipe } from '../../rpc/views'

import { recipe_for_output, recipes_consuming, short_id } from './recipes'

interface RecipeRow {
  id: string
  target_id: string | null
  name: string
  quantity: number
}

function RecipeRowLine({
  row,
  idx,
  on_select_item,
}: {
  row: RecipeRow
  idx: number
  on_select_item: (id: string) => void
}) {
  const clickable = row.target_id !== null
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 transition-none ${clickable ? 'cursor-pointer' : ''}`}
      style={{
        background: idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)',
        borderLeft: '2px solid #c8963c40',
      }}
      onClick={clickable ? () => on_select_item(row.target_id as string) : undefined}
      onMouseEnter={
        clickable
          ? (e) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'rgba(200,150,60,0.08)'
              el.style.borderLeftColor = 'var(--color-gold)'
              el.style.boxShadow = '0 0 12px rgba(200,150,60,0.1)'
            }
          : undefined
      }
      onMouseLeave={
        clickable
          ? (e) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)'
              el.style.borderLeftColor = '#c8963c40'
              el.style.boxShadow = 'none'
            }
          : undefined
      }
    >
      <span
        className="text-[9px] tracking-[0.15em] uppercase font-semibold px-2 py-0.5 shrink-0 text-gold"
        style={{ background: 'rgba(200,150,60,0.1)', border: '1px solid rgba(200,150,60,0.2)' }}
      >
        &times;{row.quantity}
      </span>
      <span className="text-[10px] tracking-[0.1em] uppercase text-text">{row.name}</span>
    </div>
  )
}

/**
 * The two crafting sections of the item detail pane (between the stat block and DROPPED BY): RECIPE (the
 * selected item's on-chain ingredients + job/level/XP chips) and INGREDIENT OF (every on-chain recipe that
 * consumes it). `items` is the /v1 encyclopedia item list (id = on-chain template id) used to resolve a
 * template id → display name + navigation target; `recipes` is the /v1 on-chain recipe list (items_tab
 * fetches both once and passes them down).
 */
function RecipeSections({
  items,
  recipes,
  selected_item,
  on_select_item,
}: {
  items: any[]
  recipes: RpcRecipe[] | undefined
  selected_item: any
  on_select_item: (id: string) => void
}) {
  const { t } = useTranslation()
  const tt = use_template_t()

  // template id → the live /v1 item (name + the navigable id). Absent → short-id, non-navigable.
  const item_by_template_id = useMemo(() => new Map((items ?? []).map((item: any) => [item.id, item])), [items])
  const resolve = (template_id: string): { name: string; target_id: string | null } => {
    const it = item_by_template_id.get(template_id)
    if (!it) return { name: short_id(template_id), target_id: null }
    return { name: tt(it, 'name') || short_id(template_id), target_id: it.id }
  }

  const selected_template_id: string = selected_item?.id || ''

  // RECIPE (forward): the on-chain recipe whose OUTPUT is the selected item — exact chain values.
  const recipe = useMemo(() => recipe_for_output(recipes, selected_template_id), [recipes, selected_template_id])
  const ingredient_rows: RecipeRow[] = useMemo(
    () =>
      (recipe?.inputs ?? []).map((ing) => {
        const { name, target_id } = resolve(ing.template_id)
        return { id: ing.template_id, target_id, name, quantity: ing.quantity }
      }),
    // resolve is a closure over item_by_template_id + tt — both in the deps.
    [recipe, item_by_template_id, tt]
  )

  // INGREDIENT OF (reverse): every on-chain recipe consuming the selected item, shown as its output item.
  const used_in: RecipeRow[] = useMemo(
    () =>
      recipes_consuming(recipes, selected_template_id).map(({ recipe: r, quantity }) => {
        const { name, target_id } = resolve(r.output_template_id)
        return { id: r.recipe_id, target_id, name, quantity }
      }),
    [recipes, selected_template_id, item_by_template_id, tt]
  )

  const job_label = recipe ? (JOBS[recipe.required_job]?.label ?? null) : null

  return (
    <>
      <SectionDivider />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold text-muted">
            {t('encyclopedia.recipe')}
          </span>
          {job_label && recipe && (
            <span
              className="text-[7px] tracking-[0.15em] uppercase px-1.5 py-px text-gold"
              style={{ border: '1px solid rgba(200,150,60,0.3)', background: 'rgba(200,150,60,0.08)' }}
            >
              {job_label}{' '}
              <span className="text-gold-light opacity-60">
                {t('encyclopedia.required_level')} {recipe.required_level}
              </span>
            </span>
          )}
          {recipe && recipe.craft_xp > 0 && (
            <span
              className="text-[7px] tracking-[0.15em] uppercase px-1.5 py-px text-cyan"
              style={{ border: '1px solid rgba(74,158,255,0.3)', background: 'rgba(74,158,255,0.06)' }}
            >
              {t('encyclopedia.xp_suffix', { xp: recipe.craft_xp })}
            </span>
          )}
          {recipe && recipe.output_quantity > 1 && (
            <span className="text-[7px] tracking-[0.15em] uppercase text-muted">
              &rarr; &times;{recipe.output_quantity}
            </span>
          )}
        </div>
        {ingredient_rows.length > 0 ? (
          <div className="flex flex-col gap-1">
            {ingredient_rows.map((ing, idx) => (
              <RecipeRowLine key={ing.id} row={ing} idx={idx} on_select_item={on_select_item} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <Sparkles size={10} className="opacity-20 text-muted" />
            <span className="text-[9px] tracking-[0.15em] uppercase text-muted italic">
              {t('encyclopedia.no_recipe')}
            </span>
          </div>
        )}
      </div>
      <SectionDivider />
      <div className="flex flex-col gap-2">
        <span className="text-[9px] tracking-[0.25em] uppercase font-semibold text-muted">
          {t('encyclopedia.ingredient_of')}
        </span>
        {used_in.length > 0 ? (
          <div className="flex flex-col gap-1">
            {used_in.map((row, idx) => (
              <RecipeRowLine key={row.id} row={row} idx={idx} on_select_item={on_select_item} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <Sparkles size={10} className="opacity-20 text-muted" />
            <span className="text-[9px] tracking-[0.15em] uppercase text-muted italic">
              {t('encyclopedia.no_ingredient_of')}
            </span>
          </div>
        )}
      </div>
    </>
  )
}

export { RecipeSections }
