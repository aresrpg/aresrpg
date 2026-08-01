// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// §14 encyclopedia bestiary — reads ON-CHAIN LIVENESS from the /v1 RPC indexer (get_encyclopedia('mobs')), the
// single source of truth, NOT a client-side chain replay. The indexer serves each minted MobTemplate's snapshot
// prefix (name / level range / hp / element) — the fields the bestiary list + element filter + level brackets
// need. The mob's resistances, spell kit and xp are NOT projected today (they live in the object's nested
// stats/spells the §14 index deliberately does not decode — see packages/rpc/indexer/src/handlers/ares/
// snapshot.rs): resistances read `m.*_resistance` defensively and DECODE through the shared chain/stat_bias.js
// home (mob resist is CENTERED @32768 — spell.move's RES_SHIFT, the same convention item_stats.move uses), so
// the section renders real signed values the day the index starts projecting it; until then every field is
// absent and the section stays honestly hidden — never a fabricated "+0%" (see the `resistances` useMemo below).
// XP and the SPELL KIT are joined from the authored corpus rows the templates were
// minted from (world_corpus.ts CorpusMobFacts — same generation, id-gated, so no drift from chain truth is
// possible). LOOT is the /v1 mob doc's server-joined ON-CHAIN drops (the indexer decodes each
// MobTemplate's loot vector; the API joins each row's item template → name/category and derives the EXACT chance%
// from the on-chain basis points). That is the SINGLE loot source — there is NO static-catalog fallback:
// if it's in the encyclopedia it's provably in game, so a seed row that never minted, or whose chance differs from
// chain, can never surface. `drops == null` (undecoded tail) renders the honest "no known drops"; an empty list is
// a genuine "no drops" — never a fabricated table.
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Shield, ArrowLeft, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { normalize_search } from '../../utils/search'
import { ArchiBadge, ELEMENT_COLORS, MobDetailView, is_new_template, NewBadge } from '../../components/entity_display'
import { get_mob_tier, is_archi_tier } from '../../game/data/mobs.js'
import { use_deferred_search } from '../../hooks/use_deferred_search'
import { ELEMENTS, MOB_LEVEL_BRACKETS } from '../../constants/encyclopedia'
import { display_mob_name } from '../../content/mob_name_overrides'
import { use_template_t } from '../../i18n/template_t'
import { get_encyclopedia } from '../../rpc/client'
import { use_rpc_view } from '../../rpc/use_view'
import type { RpcEncyclopedia, RpcEncyclopediaMob } from '../../rpc/views'
import { decode_stat } from '../../chain/stat_bias'

import { DetailLoading, ENCYCLOPEDIA_LAYOUT } from './shared'
import { v1_drops_to_display } from './loot'
import { EncyclopediaMobImage } from './mob_image'
import { mob_spell_views } from './mob_spells'
import { MobSpellsSection } from './mob_spells_section'
import { ArchimobOdds } from './archimob_odds'
import { mob_corpus_of, world_corpus_for_mob, is_listed_mob_role } from './world_corpus'

// Global spawn dial (aresrpg::config — GameConfig.archimob_bp, DEFAULT_ARCHIMOB_BP = 50 basis points,
// packages/move/aresrpg/sources/config.move:90). Admin-tunable in principle (config.move:286
// set_archimob_bp), but the indexer only projects a dial's value from its `DialChanged` event —
// GameConfig has no object-snapshot pipeline, so an admin who never touched this specific setter
// leaves it unprojected in Redis. The mint-time DEFAULT is the only value provably live today;
// hardcoded here (never re-derived) with this comment as the single source of truth to update
// if that changes.
const ARCHIMOB_CHANCE_PERCENT = 0.5

// spell::Stats element discriminants (0=fire,1=water,2=earth,3=air,255=none) → the ELEMENTS names the bestiary
// filter + colours key by. A NONE/unknown element maps to '' (unselected), never a fabricated choice.
const ELEMENT_NAMES = ['FIRE', 'WATER', 'EARTH', 'AIR']

// A mob's on-chain resistance wire is CENTERED @32768 (spell.move RES_SHIFT — the SAME convention
// item_stats.move's ItemStatistics uses), so decode through the ONE shared home the item side already
// owns (chain/stat_bias.js's decode_stat — "the ONLY place the 32768 constant may live", no second copy
// here). `null`/`undefined` (the §14 index does not project this field — see file header) passes through
// as an honest "unknown", never miscast as a neutral 0.
// Exported for bestiary_tab.test.tsx — the pure decode is the exact unit the RED-FIRST regression pins.
export const decode_mob_resist = (v: number | null | undefined): number | null => (v == null ? null : decode_stat(v))

// Pure /v1 projection reader. Kept outside the component so the captured RPC contract can exercise the
// exact empty/non-empty decision without mocking React or the request hook.
export const bestiary_mobs_from_v1 = (
  rows: readonly RpcEncyclopediaMob[] | null | undefined,
  live_worlds: Readonly<RpcEncyclopedia['worlds']> = []
) =>
  (rows ?? [])
    // /v1 is the mob-template projection this surface promises to render. Do not fence it through the
    // separately republished seed-manifest ids: a republish gives every MobTemplate a new object id, and
    // that cross-artifact equality check turned a populated 374-row response into the honest-empty screen.
    // The authored corpus remains optional enrichment (role/world/xp/spells), keyed when the ids converge.
    .filter((m) => is_listed_mob_role(mob_corpus_of(m.name)?.role))
    .map((m) => {
      const tier = get_mob_tier(m.name)
      return {
        id: m.template_id,
        name: display_mob_name(m.name) || '',
        // icon lookup stays the RAW chain/seed name (the asset catalog is keyed by it) — only the
        // display string above goes through the override.
        icon_name: m.name ?? '',
        minLevel: m.min_level ?? 0,
        maxLevel: m.max_level ?? 0,
        health: m.base_hp ?? 0,
        element: ELEMENT_NAMES[m.element ?? -1] ?? '',
        earthResistance: decode_mob_resist(m.earth_resistance),
        fireResistance: decode_mob_resist(m.fire_resistance),
        waterResistance: decode_mob_resist(m.water_resistance),
        airResistance: decode_mob_resist(m.air_resistance),
        tier,
        archi: is_archi_tier(tier),
        drops: m.drops, // authoritative on-chain loot; null means an honestly undecoded tail
        found_in: world_corpus_for_mob(m.name, live_worlds).map(({ id, name, biome }) => ({ id, name, biome })),
        createdAt: undefined as number | undefined,
      }
    })

export function BestiaryMobRow({
  mob,
  idx,
  is_selected,
  on_select,
}: Readonly<{
  mob: any
  idx: number
  is_selected: boolean
  on_select: (id: string) => void
}>) {
  const { t } = useTranslation()
  const tt = use_template_t()
  const el_color = ELEMENT_COLORS[(mob.element || '').toLowerCase()] || 'var(--color-muted)'
  return (
    <div
      className={ENCYCLOPEDIA_LAYOUT.listRow}
      style={{
        borderLeft: is_selected ? '2px solid #c8963c' : `2px solid ${el_color}40`,
        background: is_selected ? 'rgba(200,150,60,0.08)' : idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
      }}
      onClick={() => on_select(mob.id)}
      onMouseEnter={(e) => {
        if (!is_selected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        if (!is_selected)
          (e.currentTarget as HTMLElement).style.background = idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent'
      }}
    >
      <div className="flex items-center gap-2">
        <EncyclopediaMobImage mob={{ name: mob.icon_name }} className="w-8 h-8 shrink-0 object-contain" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] tracking-[0.1em] uppercase truncate" style={{ color: el_color }}>
              {tt(mob, 'name')}
            </span>
            {mob.archi && <ArchiBadge />}
            {is_new_template(mob.createdAt) && <NewBadge />}
            <span className={ENCYCLOPEDIA_LAYOUT.rowMeta}>
              {t('encyclopedia.level_range', { min: mob.minLevel, max: mob.maxLevel })}
            </span>
          </div>
          <span className="text-[8px] tracking-[0.1em] uppercase text-muted/50">{mob.element || ''}</span>
        </div>
      </div>
    </div>
  )
}

type ViewMode = 'all' | 'by_level'
type SortOption = 'level_asc' | 'level_desc' | 'name_asc'

function BestiaryTab({
  selected_mob_id,
  on_select_mob,
  on_navigate_to_item,
  on_navigate_to_world,
  is_mobile,
}: {
  selected_mob_id: string | null
  on_select_mob: (id: string) => void
  on_navigate_to_item: (id: string) => void
  on_navigate_to_world: (id: string) => void
  is_mobile: boolean
}) {
  const { t } = useTranslation()
  const tt = use_template_t()

  const { data: enc, loading } = use_rpc_view((signal) => get_encyclopedia('mobs', signal), { deps: [] })
  const { data: world_enc } = use_rpc_view((signal) => get_encyclopedia('worlds', signal), { deps: [] })
  // Map §14 liveness + projected loot into display shape; unprojected resistances stay honestly empty.
  const mobs = useMemo(() => bestiary_mobs_from_v1(enc?.mobs, world_enc?.worlds), [enc, world_enc])

  const [params, set_params] = useSearchParams()
  // Search: instant input + deferred filter term + debounced ?q= (shared home) — see use_deferred_search.
  const { value: search_input, set_value: set_search_input, term: search } = use_deferred_search()
  const view_mode = (params.get('view') || 'all') as ViewMode
  const element_filters = useMemo(() => new Set((params.get('el') || '').split(',').filter(Boolean)), [params])
  const sort = (params.get('sort') || 'level_asc') as SortOption

  const update_param = (key: string, value: string | null) => {
    set_params(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true }
    )
  }

  const toggle_set_param = (key: string, value: string) => {
    set_params(
      (prev) => {
        const next = new URLSearchParams(prev)
        const current = new Set((next.get(key) || '').split(',').filter(Boolean))
        if (current.has(value)) current.delete(value)
        else current.add(value)
        const joined = [...current].join(',')
        if (joined) next.set(key, joined)
        else next.delete(key)
        return next
      },
      { replace: true }
    )
  }

  const clear_all_filters = () => {
    set_params(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('q')
        next.delete('el')
        next.delete('sort')
        next.delete('view')
        return next
      },
      { replace: true }
    )
  }

  const sort_fn = useMemo(() => {
    switch (sort) {
      case 'level_desc':
        return (a: any, b: any) => (b.minLevel + b.maxLevel) / 2 - (a.minLevel + a.maxLevel) / 2
      case 'name_asc':
        return (a: any, b: any) => tt(a, 'name').localeCompare(tt(b, 'name'))
      case 'level_asc':
      default:
        return (a: any, b: any) => (a.minLevel + a.maxLevel) / 2 - (b.minLevel + b.maxLevel) / 2
    }
  }, [sort, tt])

  const filtered = useMemo(() => {
    return mobs
      .filter((mob: any) => {
        if (search && !normalize_search(tt(mob, 'name')).includes(normalize_search(search))) return false
        if (element_filters.size > 0 && !element_filters.has((mob.element || '').toUpperCase())) return false
        return true
      })
      .sort(sort_fn)
  }, [mobs, search, element_filters, sort_fn, tt])

  const grouped_by_level = useMemo(() => {
    if (view_mode !== 'by_level') return []
    const groups: { label: string; mobs: any[] }[] = MOB_LEVEL_BRACKETS.map((b) => ({ label: b.label, mobs: [] }))
    for (const mob of filtered) {
      const avg = ((mob.minLevel || 0) + (mob.maxLevel || 0)) / 2
      for (const [i, bracket] of MOB_LEVEL_BRACKETS.entries()) {
        if (avg >= bracket.min && avg <= bracket.max) {
          groups[i].mobs.push(mob)
          break
        }
      }
    }
    return groups.filter((g) => g.mobs.length > 0)
  }, [filtered, view_mode])

  const selected_mob = useMemo(() => {
    if (!selected_mob_id) return null
    return mobs.find((m: any) => m.id === selected_mob_id) || null
  }, [selected_mob_id, mobs])

  // Loot source: the /v1 mob doc's server-joined ON-CHAIN drops are the SINGLE source of truth:
  // encyclopedia loot derives from chain, NEVER from a static seed catalog — so a seed row that never minted, or
  // whose chance differs from chain, can never surface. An empty list is a genuine "no drops"; `null` means the
  // snapshot could not decode the loot tail → honest UNKNOWN (rendered as "no known drops"), never a fabricated table.
  const drops = useMemo(() => {
    const on_chain = selected_mob?.drops
    return on_chain != null ? v1_drops_to_display(on_chain) : null
  }, [selected_mob])

  // Resistances: already DECODED real signed values (see decode_mob_resist above) or `null` per field when
  // the §14 index doesn't project them (true for every mob today). Every field absent → `null` here too, so
  // MobDetailView's own `resistances != null` gate hides the section — honest-empty, matching the drops idiom,
  // never a fabricated "+0%" for a stat nobody measured.
  const resistances = useMemo(() => {
    if (!selected_mob) return null
    const { earthResistance: earth, fireResistance: fire, waterResistance: water, airResistance: air } = selected_mob
    if (earth == null && fire == null && water == null && air == null) return null
    return { earth: earth ?? 0, fire: fire ?? 0, water: water ?? 0, air: air ?? 0 }
  }, [selected_mob])

  // Authored per-template facts (xp + the spell kit) — minted VERBATIM from these corpus rows and
  // id-gated to the living generation (world_corpus.ts CorpusMobFacts), so nothing here can drift from
  // chain truth. A missing row degrades honestly: no xp box, no spells section.
  const corpus_facts = useMemo(() => (selected_mob ? mob_corpus_of(selected_mob.icon_name) : undefined), [selected_mob])
  const spell_views = useMemo(() => mob_spell_views(corpus_facts?.spells), [corpus_facts])

  const has_active_filters = search !== '' || element_filters.size > 0 || sort !== 'level_asc' || view_mode !== 'all'

  const active_chips: { label: string; clear: () => void }[] = []
  if (search) active_chips.push({ label: `"${search}"`, clear: () => set_search_input('') })
  for (const el of element_filters) active_chips.push({ label: el, clear: () => toggle_set_param('el', el) })
  if (sort !== 'level_asc')
    active_chips.push({ label: sort.replace('_', ' ').toUpperCase(), clear: () => update_param('sort', null) })

  const render_mob_row = (mob: any, idx: number) => {
    const is_selected = selected_mob_id === mob.id
    return <BestiaryMobRow key={mob.id} mob={mob} idx={idx} is_selected={is_selected} on_select={on_select_mob} />
  }

  const render_grid_content = () => {
    if (filtered.length === 0) {
      return (
        <div className={ENCYCLOPEDIA_LAYOUT.empty}>
          <Search size={16} style={{ opacity: 0.3 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.no_mobs_match')}</span>
          {has_active_filters && (
            <button
              type="button"
              className="text-[8px] tracking-[0.15em] uppercase px-3 py-1 border border-gold/30 text-gold cursor-pointer"
              style={{ background: 'rgba(200,150,60,0.06)' }}
              onClick={clear_all_filters}
            >
              {t('encyclopedia.clear_all')}
            </button>
          )}
        </div>
      )
    }

    if (view_mode === 'by_level') {
      return (
        <>
          {grouped_by_level.map((group, gi) => (
            <div
              key={group.label}
              style={gi > 0 ? { borderTop: '1px solid rgba(200,150,60,0.08)', marginTop: 4 } : undefined}
            >
              <div
                className="px-3 py-2 text-[8px] tracking-[0.25em] uppercase text-gold/60"
                style={{
                  background: 'rgba(200,150,60,0.04)',
                  borderLeft: '2px solid rgba(200,150,60,0.3)',
                  borderBottom: '1px solid rgba(200,150,60,0.1)',
                }}
              >
                <Shield size={8} style={{ display: 'inline', opacity: 0.3, marginRight: 3, verticalAlign: 'middle' }} />
                {t('encyclopedia.level_bracket', { range: group.label })}
              </div>
              <div className="grid gap-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {group.mobs.map((mob, i) => render_mob_row(mob, i))}
              </div>
            </div>
          ))}
        </>
      )
    }

    return (
      <div className="grid gap-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {filtered.map((mob, i) => render_mob_row(mob, i))}
      </div>
    )
  }

  if (loading) {
    return (
      <div className={ENCYCLOPEDIA_LAYOUT.center}>
        <DetailLoading />
      </div>
    )
  }

  if (mobs.length === 0) {
    return (
      <div className={ENCYCLOPEDIA_LAYOUT.failed}>
        <Shield size={24} style={{ opacity: 0.2 }} />
        <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.no_mobs_onchain')}</span>
      </div>
    )
  }

  const filter_bar = (
    <div className={ENCYCLOPEDIA_LAYOUT.filters}>
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className={ENCYCLOPEDIA_LAYOUT.searchIcon} />
          <input
            className="template-input w-full"
            placeholder={t('encyclopedia.search_mobs')}
            value={search_input}
            onChange={(e) => set_search_input(e.target.value)}
            style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', paddingLeft: 36 }}
          />
        </div>
        <span className={ENCYCLOPEDIA_LAYOUT.filterLabel}>
          {t('encyclopedia.showing_mobs', { count: filtered.length, total: mobs.length })}
        </span>
        <select
          className="template-input shrink-0"
          value={sort}
          onChange={(e) => update_param('sort', e.target.value === 'level_asc' ? null : e.target.value)}
          style={{ fontSize: 8, letterSpacing: '0.15em', textTransform: 'uppercase', width: 'auto', paddingRight: 20 }}
        >
          <option value="level_asc">{t('encyclopedia.sort_level_asc')}</option>
          <option value="level_desc">{t('encyclopedia.sort_level_desc')}</option>
          <option value="name_asc">{t('encyclopedia.sort_name_asc')}</option>
        </select>
      </div>

      <div className="app-mobile-chip-row flex flex-wrap items-center gap-1">
        {(
          [
            ['all', t('encyclopedia.view_all')],
            ['by_level', t('encyclopedia.view_by_level')],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={`category-pill ${view_mode === mode ? 'active' : ''}`}
            onClick={() => update_param('view', mode === 'all' ? null : mode)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {ELEMENTS.map((el) => {
            const color = ELEMENT_COLORS[el.toLowerCase()] || 'var(--color-muted)'
            const active = element_filters.has(el)
            return (
              <button
                key={el}
                type="button"
                className="cursor-pointer"
                title={el}
                onClick={() => toggle_set_param('el', el)}
                style={{
                  width: 8,
                  height: 8,
                  background: color,
                  opacity: active ? 1 : 0.3,
                  boxShadow: active ? `0 0 8px ${color}` : 'none',
                  transition: 'opacity 0.15s, box-shadow 0.15s',
                }}
              />
            )
          })}
        </div>

        {active_chips.map((chip, i) => (
          <span
            key={i}
            className="flex items-center gap-1 text-[7px] tracking-[0.15em] uppercase px-1.5 py-0.5 text-gold border border-gold/20"
            style={{ background: 'rgba(200,150,60,0.06)' }}
          >
            {chip.label}
            <X size={8} className="opacity-50 cursor-pointer hover:opacity-100" onClick={chip.clear} />
          </span>
        ))}

        {has_active_filters && (
          <button
            type="button"
            className="text-[7px] tracking-[0.15em] uppercase text-muted cursor-pointer hover:text-gold"
            onClick={clear_all_filters}
          >
            {t('encyclopedia.clear_all')}
          </button>
        )}
      </div>
    </div>
  )

  const detail_panel = (
    <div className={`flex-1 overflow-y-auto ${is_mobile ? 'p-3' : 'p-4 pt-14'}`}>
      {!selected_mob ? (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
          <Shield size={24} style={{ opacity: 0.2 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.select_mob')}</span>
        </div>
      ) : (
        <MobDetailView
          mob={{
            name: tt(selected_mob, 'name'),
            icon_name: selected_mob.icon_name,
            element: selected_mob.element || '',
            minLevel: selected_mob.minLevel || 0,
            maxLevel: selected_mob.maxLevel || 0,
            health: selected_mob.health || 0,
            xpReward: corpus_facts?.xp ?? null,
            isBoss: false,
            tier: selected_mob.tier,
            createdAt: selected_mob.createdAt,
            stats: {},
            resistances,
            drops,
            archi_mob: null,
            is_archi_of: null,
            found_in: selected_mob.found_in,
          }}
          on_navigate_to_item={on_navigate_to_item}
          on_navigate_to_mob={on_select_mob}
          on_navigate_to_world={on_navigate_to_world}
          show_stats={false}
        >
          <MobSpellsSection spells={spell_views} />
          {/* Archimob odds only where a mob is actually archi-eligible — role is the authored
              corpus flag, joined the same way xp/spells are (mob_corpus_of), never invented client-side. */}
          <ArchimobOdds eligible={corpus_facts?.role === 'archi'} chance={ARCHIMOB_CHANCE_PERCENT} />
        </MobDetailView>
      )}
    </div>
  )

  if (is_mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {selected_mob ? (
          <>
            <button
              type="button"
              onClick={() => on_select_mob(null as any)}
              className="flex items-center gap-2 px-3 py-2 text-muted text-[10px] tracking-[0.15em] uppercase hover:text-gold transition-colors border-b border-border shrink-0 cursor-pointer"
            >
              <ArrowLeft size={12} /> {t('encyclopedia.back_to_list')}
            </button>
            {detail_panel}
          </>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {filter_bar}
            <div className={ENCYCLOPEDIA_LAYOUT.scroll}>{render_grid_content()}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      <div className={`flex flex-col min-w-0 min-h-0 ${selected_mob ? 'flex-[7]' : 'flex-1'}`}>
        {filter_bar}
        <div className={ENCYCLOPEDIA_LAYOUT.scroll}>{render_grid_content()}</div>
      </div>
      {selected_mob && <div className={ENCYCLOPEDIA_LAYOUT.detail}>{detail_panel}</div>}
    </div>
  )
}

export { BestiaryTab }
