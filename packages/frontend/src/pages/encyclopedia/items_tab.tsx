// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// §14 liveness/supply/sales/loot/recipes come from /v1. Authored characteristics and icon slugs join the same
// seed/mainnet corpus that mints templates, by slug only; missing joins remain honestly empty. See item_catalog.ts.
import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Swords, ArrowLeft, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { catalog, slugs, pet_food_slugs } from 'virtual:item_catalog'

import { SectionDivider, ItemDetailView, is_new_template, NewBadge } from '../../components/entity_display'
import { ItemImage } from '../../components/items'
import { FoundInWorldsSection } from '../../components/mob_detail_view'
import { PetFullFedNote } from '../../components/pet_power_card'
import { use_deferred_search } from '../../hooks/use_deferred_search'
import { CATEGORY_GROUPS, type CategoryGroupKey } from '../../constants/encyclopedia'
import { display_mob_name } from '../../content/mob_name_overrides'
import { normalize_search } from '../../utils/search'
import { use_template_t } from '../../i18n/template_t'
import { get_encyclopedia, get_rare_links } from '../../rpc/client'
import { use_rpc_view } from '../../rpc/use_view'
import { use_items_shop_chain } from '../../stores/items_shop_chain'
import { marketplace_item_type_key } from '../../components/marketplace/marketplace_model'

import { DetailLoading, ENCYCLOPEDIA_LAYOUT } from './shared'
import { encyclopedia_item_view } from './item_view_model'
import { DroppedBySection } from './dropped_by_section'
import { PetFoodSection } from './pet_food_section'
import { RecipeSections } from './recipe_sections'
import { encyclopedia_item_asset } from './encyclopedia_assets'
import { item_type_of, item_type_label_key, item_type_buckets } from './item_type_rail'
import { ItemTypeRail } from './ItemTypeRail'
// Both maps are derived at build time by virtual:item_catalog; no checked-in seed projection can go stale.
import { make_catalog_lookup, selected_item_for_route } from './item_catalog'
import { invert_mob_drops } from './dropped_by'
import { world_corpus_for_resource } from './world_corpus'

const catalog_for_name = make_catalog_lookup({ catalog, slugs })

// §6 gathering.move RARE_BP=10; existence is per resource, but the immutable rate is game-wide.
const GOLDEN_GATHER_CHANCE_PERCENT = 0.1

const GROUP_KEYS = Object.keys(CATEGORY_GROUPS) as CategoryGroupKey[]

type SortOption = 'level_asc' | 'level_desc' | 'name_asc'
const SORT_OPTIONS: SortOption[] = ['level_asc', 'level_desc', 'name_asc']
const SORT_I18N: Record<SortOption, string> = {
  level_asc: 'sort_level_asc',
  level_desc: 'sort_level_desc',
  name_asc: 'sort_name',
}

export function ItemsTab({
  selected_item_id,
  on_select_item,
  on_navigate_to_mob,
  on_navigate_to_world,
  is_mobile,
}: {
  selected_item_id: string | null
  on_select_item: (id: string) => void
  on_navigate_to_mob: (id: string) => void
  on_navigate_to_world: (id: string) => void
  is_mobile: boolean
}) {
  const { t } = useTranslation()
  const tt = use_template_t()
  // The live primary shop supplies the third obtention signal alongside recipes and drops.
  const { sales: shop_sales, load: load_shop_sales } = use_items_shop_chain()
  useEffect(() => {
    load_shop_sales()
  }, [load_shop_sales])

  // The API's no-kind form returns every catalog kind. One shared, app-lifetime client read feeds the item rows,
  // recipes, and inverted mob drops instead of mounting three independent 5-second pollers.
  const { data: enc, loading } = use_rpc_view((signal) => get_encyclopedia(undefined, signal), { deps: [] })
  const recipes = enc?.recipes
  // Golden-gather links are existence-only; the rate is the published constant above.
  const { data: rare_links } = use_rpc_view((signal) => get_rare_links(undefined, signal), { deps: [] })
  // Invert the same authoritative on-chain mob loot projection the bestiary renders forward (dropped_by.ts —
  // the one home). Live rows in, live droppers out: no build-time id set fences this join (#1467).
  const live_dropped_by_index = useMemo(() => invert_mob_drops(enc?.mobs, display_mob_name), [enc])
  // Join each live /v1 row to authored characteristics by slug; unmatched rows stay honestly empty. The
  // row → detail-view projection itself lives in item_view_model.ts — the ONE home the in-game Jobs drawer
  // reads too, so a crafting surface can never disagree with the encyclopedia about what an item IS.
  const items = useMemo(
    () =>
      (enc?.items ?? []).map((it) => {
        const name = it.name ?? ''
        return encyclopedia_item_view(it, { slug: slugs[name] || undefined, catalog_row: catalog_for_name(name) })
      }),
    [enc]
  )

  const [params, set_params] = useSearchParams()
  // Keep typing instant while deferring the 1.8k-row filter and debounced query-string update.
  const { value: search_input, set_value: set_search_input, term: search } = use_deferred_search()
  const group = (params.get('group') || 'ALL') as CategoryGroupKey
  const sub = params.get('sub') || null
  const level_min = params.get('lmin') || ''
  const level_max = params.get('lmax') || ''
  const sort = (params.get('sort') || 'level_asc') as SortOption

  const update_param = (key: string, value: string) => {
    set_params(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === 'ALL' || value === 'level_asc') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true }
    )
  }

  const clear_all_filters = () => set_params({}, { replace: true })

  const filtered = useMemo(() => {
    const min = level_min ? parseInt(level_min) : 0
    const max = level_max ? parseInt(level_max) : Infinity
    const group_set = CATEGORY_GROUPS[group] || null

    return items
      .filter((item: any) => {
        if (search && !normalize_search(tt(item, 'name')).includes(normalize_search(search))) return false
        if (sub) {
          if (item_type_of(item) !== sub) return false
        } else if (group_set) {
          if (!group_set.has(item.category)) return false
        }
        if ((item.level || 0) < min || (item.level || 0) > max) return false
        return true
      })
      .sort((a: any, b: any) => {
        switch (sort) {
          case 'level_desc':
            return (b.level || 0) - (a.level || 0)
          case 'name_asc':
            return tt(a, 'name').localeCompare(tt(b, 'name'))
          case 'level_asc':
          default:
            return (a.level || 0) - (b.level || 0)
        }
      })
  }, [search, group, sub, level_min, level_max, sort, items, tt])

  const selected_item = useMemo(() => {
    return selected_item_for_route(items, selected_item_id)
  }, [selected_item_id, items])

  // No live projected drop source means the honest no-drops state, never a seed fabrication.
  const dropped_by = useMemo(() => {
    if (!selected_item) return null
    return live_dropped_by_index.get(selected_item.id) ?? null
  }, [selected_item, live_dropped_by_index])

  // Presence-only obtention signal from the same on-chain recipes rendered below.
  const has_recipe = useMemo(() => {
    if (!selected_item) return false
    return recipes?.some((r) => r.output_template_id === selected_item.id) ?? false
  }, [selected_item, recipes])

  // Shop sales and encyclopedia items share template IDs, so no slug conversion belongs here.
  const sold_in_shop = useMemo(
    () => !!selected_item && shop_sales.some((sale) => sale.template_id === selected_item.id),
    [selected_item, shop_sales]
  )

  const obtention = useMemo(
    () => (selected_item ? { dropped_count: dropped_by?.length ?? 0, has_recipe, sold_in_shop } : null),
    [selected_item, dropped_by, has_recipe, sold_in_shop]
  )

  const has_golden_variant = useMemo(
    () => !!selected_item && (rare_links ?? []).some((l) => l.template_id === selected_item.id),
    [selected_item, rare_links]
  )

  // Gatherable placement provenance — the mob pages' FOUND IN idiom over the same authored corpus
  // (world_corpus_for_resource; night-batch #8). Empty for non-gatherables → the section renders nothing.
  const found_in = useMemo(
    () =>
      selected_item
        ? world_corpus_for_resource(selected_item.name, enc?.worlds).map(({ id, name, biome }) => ({
            id,
            name,
            biome,
          }))
        : [],
    [selected_item, enc?.worlds]
  )

  const active_chips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = []
    if (group !== 'ALL')
      chips.push({
        key: 'group',
        label: t(`encyclopedia.group_${group.toLowerCase()}`),
        clear: () => update_param('group', ''),
      })
    if (sub)
      chips.push({ key: 'sub', label: t(marketplace_item_type_key(sub), sub), clear: () => update_param('sub', '') })
    if (level_min) chips.push({ key: 'lmin', label: `LV ${level_min}+`, clear: () => update_param('lmin', '') })
    if (level_max) chips.push({ key: 'lmax', label: `LV -${level_max}`, clear: () => update_param('lmax', '') })
    if (sort !== 'level_asc')
      chips.push({ key: 'sort', label: t(`encyclopedia.${SORT_I18N[sort]}`), clear: () => update_param('sort', '') })
    return chips
  }, [group, sub, level_min, level_max, sort, t])

  // THE THIRD COLUMN'S data (issue #31 ①): real per-type buckets over the items actually IN this group,
  // never the static category enum — a collapsed cosmetic category (item_display_category) previously left
  // NOTHING to divide COSMETICS by, so its rail silently never appeared and every cosmetic card's type
  // label read the same generic string (②). item_type_buckets resolves each item's SPECIFIC type
  // (item_type_rail.ts — reuses the marketplace's own cosmetic-aware projection, one home) and naturally
  // reduces to one bucket wherever a group genuinely has only one type, hiding the rail (redundant rule).
  const group_items = useMemo(() => {
    const group_set = CATEGORY_GROUPS[group] || null
    return group_set ? items.filter((item: any) => group_set.has(item.category)) : items
  }, [group, items])
  const sub_categories = useMemo(() => item_type_buckets(group_items), [group_items])

  if (loading) {
    return (
      <div className={ENCYCLOPEDIA_LAYOUT.center}>
        <DetailLoading />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={ENCYCLOPEDIA_LAYOUT.failed}>
        <Swords size={24} style={{ opacity: 0.2 }} />
        <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.no_items_onchain')}</span>
      </div>
    )
  }

  const filter_bar = (
    <div className={ENCYCLOPEDIA_LAYOUT.filters}>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className={ENCYCLOPEDIA_LAYOUT.searchIcon} />
          <input
            className="template-input w-full"
            placeholder={t('encyclopedia.search_items')}
            value={search_input}
            onChange={(e) => set_search_input(e.target.value)}
            style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', paddingLeft: 36 }}
          />
        </div>
        <span className={ENCYCLOPEDIA_LAYOUT.filterLabel}>
          {t('encyclopedia.showing_count', { count: filtered.length, total: items.length })}
        </span>
        <select
          className="template-input cursor-pointer"
          style={{ fontSize: 9, width: 'auto', minWidth: 100 }}
          value={sort}
          onChange={(e) => update_param('sort', e.target.value)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {t(`encyclopedia.${SORT_I18N[opt]}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="app-mobile-chip-row flex flex-wrap gap-1">
        {GROUP_KEYS.map((g) => (
          <button
            key={g}
            type="button"
            className={`category-pill ${group === g ? 'active' : ''}`}
            onClick={() => {
              set_params(
                (prev) => {
                  const next = new URLSearchParams(prev)
                  if (g === 'ALL') next.delete('group')
                  else next.set('group', g)
                  next.delete('sub')
                  return next
                },
                { replace: true }
              )
            }}
          >
            {g === 'ALL' ? t('encyclopedia.view_all') : t(`encyclopedia.group_${g.toLowerCase()}`)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] tracking-[0.15em] uppercase text-muted">LVL</span>
          <input
            className="template-input"
            placeholder="MIN"
            value={level_min}
            onChange={(e) => update_param('lmin', e.target.value.replace(/\D/g, ''))}
            style={{ width: 50, fontSize: 9, textAlign: 'center' }}
          />
          <span className="text-[8px] text-muted">&ndash;</span>
          <input
            className="template-input"
            placeholder="MAX"
            value={level_max}
            onChange={(e) => update_param('lmax', e.target.value.replace(/\D/g, ''))}
            style={{ width: 50, fontSize: 9, textAlign: 'center' }}
          />
        </div>

        {active_chips.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {active_chips.map((chip) => (
              <span
                key={chip.key}
                className="flex items-center gap-1 text-[7px] tracking-[0.15em] uppercase px-1.5 py-px text-gold cursor-pointer"
                style={{ background: 'rgba(200,150,60,0.05)', border: '1px solid rgba(200,150,60,0.3)' }}
                onClick={chip.clear}
              >
                {chip.label}
              </span>
            ))}
            {active_chips.length > 1 && (
              <button
                type="button"
                className="text-[7px] tracking-[0.15em] uppercase text-muted hover:text-gold cursor-pointer"
                onClick={clear_all_filters}
              >
                {t('encyclopedia.clear_all')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  const items_grid = (
    <div className={ENCYCLOPEDIA_LAYOUT.scroll}>
      {filtered.length === 0 ? (
        <div className={ENCYCLOPEDIA_LAYOUT.empty}>
          <Search size={16} style={{ opacity: 0.3 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.no_results')}</span>
          <button className="btn-outline text-[8px] px-3 py-1" onClick={clear_all_filters}>
            {t('encyclopedia.clear_filters')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map((item: any, idx: number) => {
            const is_selected = selected_item_id === item.id
            const asset = encyclopedia_item_asset(item)
            return (
              <div
                key={item.id}
                className={ENCYCLOPEDIA_LAYOUT.listRow}
                style={{
                  borderLeft: is_selected ? '2px solid #c8963c' : '2px solid rgba(255,255,255,0.08)',
                  background: is_selected
                    ? 'rgba(200,150,60,0.08)'
                    : idx % 2 === 1
                      ? 'rgba(255,255,255,0.02)'
                      : 'transparent',
                }}
                onClick={() => on_select_item(item.id)}
                onMouseEnter={(e) => {
                  if (!is_selected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={(e) => {
                  if (!is_selected)
                    (e.currentTarget as HTMLElement).style.background =
                      idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent'
                }}
              >
                <div className="flex items-center gap-2">
                  <ItemImage
                    id={asset.id}
                    image_url={asset.image_url}
                    category={item.category}
                    className="w-8 h-8 shrink-0"
                    eager
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] tracking-[0.1em] uppercase truncate text-text">
                        {tt(item, 'name')}
                      </span>
                      {is_new_template(item.createdAt) && <NewBadge />}
                      {/* No "Lv. 0" — cosmetics (and any level-less item) carry no level; a level line there
                          is a lie (mirrors ItemDetailView's same rule — one home, not two). */}
                      {item.level > 0 && (
                        <span className={ENCYCLOPEDIA_LAYOUT.rowMeta}>
                          {t('entity.level_short', { level: item.level })}
                        </span>
                      )}
                    </div>
                    <span className="text-[8px] tracking-[0.1em] uppercase text-muted/50">
                      {/* The SPECIFIC type (hat/cloak/title), never the collapsed COSMETICS bucket. */}
                      {t(item_type_label_key(item), item_type_of(item)) as string}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const items_detail_panel = (
    <div className={`flex-1 overflow-y-auto ${is_mobile ? 'p-3' : 'p-4 pt-14'}`}>
      {!selected_item ? (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
          <Swords size={24} style={{ opacity: 0.2 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.select_item')}</span>
        </div>
      ) : (
        <ItemDetailView
          item={{
            // The page resolver applies cosmetic reslug aliases and selects the cosmetic_icon quilt; ItemImage
            // still owns HD→base→glyph fallback and ordinary item-quilt routing.
            id: encyclopedia_item_asset(selected_item).id,
            image_url: encyclopedia_item_asset(selected_item).image_url,
            name: tt(selected_item, 'name'),
            // template_t overlays the slug-keyed locale catalog on /v1's English Display description.
            description: tt(selected_item, 'description'),
            category: selected_item.category,
            rarity: selected_item.rarity || '',
            level: selected_item.level || 0,
            createdAt: selected_item.createdAt,
            damages: selected_item.damages || [],
            stats: selected_item.stats || {},
            supply: selected_item.supply ?? 0,
            last_sale_mist: selected_item.last_sale_mist ?? null,
            obtention,
          }}
        >
          {selected_item.category === 'PET' && <PetFullFedNote />}
          {/* WHAT THE PET EATS — the global D757 food set (the mechanic is pet-agnostic; pet_foods.ts). */}
          {selected_item.category === 'PET' && (
            <PetFoodSection items={items} food_slugs={pet_food_slugs} on_select_item={on_select_item} />
          )}
          {has_golden_variant && (
            <>
              <div
                className="flex items-center gap-1.5 text-[9px] tracking-[0.1em] px-2 py-1.5"
                style={{ color: '#6b7280' }}
                title={t('entity.golden_variant_odds_tooltip')}
              >
                <Sparkles size={11} className="shrink-0" style={{ opacity: 0.5, color: '#f5d0a9' }} />
                <span style={{ color: '#c8963c' }}>{GOLDEN_GATHER_CHANCE_PERCENT}%</span>
                <span className="uppercase">{t('entity.golden_variant_odds')}</span>
              </div>
              <SectionDivider />
            </>
          )}
          <RecipeSections
            items={items}
            recipes={recipes}
            selected_item={selected_item}
            on_select_item={on_select_item}
          />
          <SectionDivider />
          <DroppedBySection dropped_by={dropped_by} on_navigate_to_mob={on_navigate_to_mob} />
          <FoundInWorldsSection worlds={found_in} on_navigate_to_world={on_navigate_to_world} />
        </ItemDetailView>
      )}
    </div>
  )

  // THE THIRD COLUMN (issue #31 ①) — a rail beside the grid, never a top tab. Redundant-hidden: a group
  // whose items resolve to one type (item_type_buckets) has nothing to divide by, so the rail vanishes
  // (mirrors the marketplace's own subcategory-column rule, one law in two features).
  const type_rail = sub_categories.length > 0 && (
    <ItemTypeRail
      buckets={sub_categories}
      active={sub}
      mobile={is_mobile}
      on_pick={(type) => update_param('sub', sub === type ? '' : type)}
    />
  )

  if (is_mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {selected_item ? (
          <>
            <button
              type="button"
              onClick={() => on_select_item(null as any)}
              className="flex items-center gap-2 px-3 py-2 text-muted text-[10px] tracking-[0.15em] uppercase hover:text-gold transition-colors border-b border-border shrink-0 cursor-pointer"
            >
              <ArrowLeft size={12} /> {t('encyclopedia.back_to_list')}
            </button>
            {items_detail_panel}
          </>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {filter_bar}
            {type_rail}
            {items_grid}
          </div>
        )}
      </div>
    )
  }

  if (!selected_item_id) {
    return (
      <div className="flex flex-1 min-h-0">
        {type_rail}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {filter_bar}
          {items_grid}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      {type_rail}
      <div className="flex flex-col flex-[7] min-w-0 min-h-0">
        {filter_bar}
        {items_grid}
      </div>
      <div className={ENCYCLOPEDIA_LAYOUT.detail}>{items_detail_panel}</div>
    </div>
  )
}
