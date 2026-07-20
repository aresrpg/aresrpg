// WORLD tab — shared by the real encyclopedia (pages/encyclopedia/index.tsx, chain-listed) AND the admin
// SEEDS tab (components/admin_seeds_tab.tsx, local-seed-sourced). ONE presentational component, fed a plain
// WorldRow[] by each caller — it knows nothing about /v1 or seed JSON (the same idea of clickable mobs
// in them, same card as item and mobs).
//
// The chain says WHICH worlds are live (/v1/encyclopedia?kind=worlds → {world_id, seed, biome}); the
// authored world_corpus artifact (generated at seed time, freshness-gated) says what they ARE — name,
// level band, mob roster and gatherable resources. index.tsx joins the two (see world_corpus.ts for why
// the roster/resources cannot come from /v1: its mob rows carry no world provenance). A live world with
// no authored corpus row still renders, honestly degraded (name = an elided id, band/roster/resources
// null) — band null ⇒ "unknown", mobs/resources undefined ⇒ the "not yet projected" note, exactly the
// same "honest unknown" law as the mob/item detail panes; never a fabricated 0-0 or an empty roster faked
// as real. Admin/local mode passes the same-shape WorldRow resolved straight from the repo seed.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Globe2, ArrowLeft, DoorOpen, Sparkles, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { normalize_search } from '../../utils/search'
import { ELEMENT_COLORS, SectionDivider, SectionTitle } from '../../components/entity_display'
import { ItemImage } from '../../components/items'
import { use_template_t } from '../../i18n/template_t'
import { use_deferred_search } from '../../hooks/use_deferred_search'

import { DetailLoading } from './shared'
// The ONE encyclopedia mob-icon home (walrus `mob_icon` quilt, the bestiary's own resolver) — NOT the
// generic components/mob_image, whose `/sprites/…` fallback the encyclopedia forbids returning to the
// browser (see encyclopedia_assets.ts). One home = the roster icon can never drift from the bestiary's.
import { EncyclopediaMobImage } from './mob_image'

export interface WorldMobRosterRow {
  id: string
  name: string
  element?: string | null
  /** trash · archi · elite · boss · dungeon_boss (authored) — undefined ⇒ role tag hidden. */
  role?: string | null
  minLevel: number
  maxLevel: number
}

export interface WorldResourceRow {
  /** on-chain item TEMPLATE id — the key on_select_item / the items detail route match on. */
  id: string
  /** asset slug — the key ItemImage builds its URL from (…/items/{slug}.png), never the id. */
  slug?: string
  name: string
  /** localized {name:{<locale>}} blob for template_t (undefined ⇒ EN-only). */
  i18nJson?: string
  category?: string
  /** 0 farmer · 1 herbalist · 2 miner (authored gather job). */
  job?: number
  /** re-tier truth — must show (world 1 quartz T1 · world 11 diamond T11). */
  tier?: number
  level?: number
}

export interface WorldDungeonRoom {
  mobs: WorldMobRosterRow[]
}

export interface WorldRow {
  id: string
  name: string
  /** the world OBJECT id — a copyable mono sub-line in the detail pane (never the card title). */
  address?: string
  /** null = not projected on this data source (chain-mode gap) — rendered as an honest "unknown", never 0-0. */
  band: [number, number] | null
  biome: string
  description?: string
  /** undefined = gap (chain mode); [] = a genuine empty roster. */
  mobs?: WorldMobRosterRow[]
  resources?: WorldResourceRow[]
  dungeon?: { key?: string; rooms: WorldDungeonRoom[] } | null
}

type SortOption = 'band_asc' | 'name_asc'

// Authored role → accent (boss reads hottest, trash coldest). Keys match mobs.json `role`.
const ROLE_COLOR: Record<string, string> = {
  dungeon_boss: '#e5484d',
  boss: '#e5484d',
  archi: '#c8963c',
  elite: '#4a9eff',
  trash: 'var(--color-muted)',
}

// 0 farmer · 1 herbalist · 2 miner (world.json authoring order). i18n key suffix for the gather-job tag.
const GATHER_JOB_KEY = ['farmer', 'herbalist', 'miner'] as const

function WorldCard({
  world,
  is_selected,
  on_select,
}: {
  world: WorldRow
  is_selected: boolean
  on_select: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col gap-0.5 px-3 py-2 cursor-pointer"
      style={{
        borderLeft: is_selected ? '2px solid #c8963c' : '2px solid rgba(74,158,255,0.25)',
        background: is_selected ? 'rgba(200,150,60,0.08)' : 'transparent',
      }}
      onClick={on_select}
      onMouseEnter={(e) => {
        if (!is_selected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        if (!is_selected) (e.currentTarget as HTMLElement).style.background = 'transparent'
      }}
    >
      <div className="flex items-center gap-2">
        <Globe2 size={12} className="shrink-0 opacity-50 text-cyan" />
        <span className="text-[10px] tracking-[0.1em] uppercase truncate text-gold flex-1">{world.name}</span>
        {world.band && (
          <span className="text-[9px] shrink-0 text-muted">
            {t('encyclopedia.level_range', { min: world.band[0], max: world.band[1] })}
          </span>
        )}
      </div>
      <span className="text-[8px] tracking-[0.15em] uppercase text-muted/60 truncate pl-[18px]">{world.biome}</span>
    </div>
  )
}

export function RosterChip({ mob, on_click }: { mob: WorldMobRosterRow; on_click?: () => void }) {
  const { t } = useTranslation()
  const el_color = ELEMENT_COLORS[(mob.element || '').toLowerCase()] || 'var(--color-muted)'
  const role = (mob.role || '').toLowerCase()
  const role_color = ROLE_COLOR[role]
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 ${on_click ? 'cursor-pointer' : ''}`}
      style={{ background: 'rgba(255,255,255,0.02)' }}
      onClick={on_click}
      onMouseEnter={
        on_click ? (e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(200,150,60,0.08)') : undefined
      }
      onMouseLeave={
        on_click ? (e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)') : undefined
      }
    >
      <EncyclopediaMobImage mob={{ name: mob.name }} className="w-5 h-5 object-contain shrink-0" />
      <span className="w-1.5 h-1.5 shrink-0" style={{ background: el_color }} />
      <span className="text-[9px] tracking-[0.1em] uppercase flex-1 truncate text-text">{mob.name}</span>
      {role_color && (
        <span
          className="text-[7px] tracking-[0.15em] uppercase shrink-0 px-1 py-px border"
          style={{ color: role_color, borderColor: role_color, opacity: 0.7 }}
        >
          {t(`encyclopedia.world_role.${role}`, role)}
        </span>
      )}
      <span className="text-[8px] tracking-wide shrink-0 text-muted">
        Lv. {mob.minLevel}-{mob.maxLevel}
      </span>
    </div>
  )
}

function ResourceChip({ resource, on_click }: { resource: WorldResourceRow; on_click?: () => void }) {
  const { t } = useTranslation()
  const tt = use_template_t()
  const job_key = resource.job != null ? GATHER_JOB_KEY[resource.job] : undefined
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 ${on_click ? 'cursor-pointer' : ''}`}
      style={{ background: 'rgba(255,255,255,0.02)' }}
      onClick={on_click}
      onMouseEnter={
        on_click ? (e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(200,150,60,0.08)') : undefined
      }
      onMouseLeave={
        on_click ? (e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)') : undefined
      }
    >
      {/* ItemImage keys on the asset SLUG (…/items/{slug}.png), never the 0x template id — see items_tab. */}
      <ItemImage
        id={resource.slug ?? resource.id}
        category={resource.category}
        className="w-5 h-5 object-contain shrink-0"
      />
      <span className="text-[9px] tracking-[0.1em] uppercase flex-1 truncate text-text">{tt(resource, 'name')}</span>
      {job_key && (
        <span className="text-[7px] tracking-[0.15em] uppercase shrink-0 text-cyan/70">
          {t(`encyclopedia.gather_job.${job_key}`, job_key)}
        </span>
      )}
      {resource.tier != null && (
        <span className="text-[8px] tracking-wide shrink-0 text-gold/70">
          {t('encyclopedia.world_resource_tier', { tier: resource.tier })}
        </span>
      )}
      {resource.level != null && (
        <span className="text-[8px] tracking-wide shrink-0 text-muted">
          {t('entity.level_short', { level: resource.level })}
        </span>
      )}
    </div>
  )
}

// The world OBJECT id, demoted to a copyable mono sub-line (the card title is the authored NAME now).
function WorldAddress({ address }: { address: string }) {
  const { t } = useTranslation()
  const [copied, set_copied] = useState(false)
  const short = `${address.slice(0, 10)}…${address.slice(-6)}`
  return (
    <button
      type="button"
      title={address}
      onClick={() => {
        navigator.clipboard?.writeText(address).then(
          () => {
            set_copied(true)
            setTimeout(() => set_copied(false), 1200)
          },
          () => {}
        )
      }}
      className="flex items-center gap-1 text-[8px] font-mono tracking-tight text-muted/50 hover:text-cyan/70 transition-colors cursor-pointer w-fit"
    >
      <Copy size={9} className="opacity-50 shrink-0" />
      <span className="truncate">{copied ? t('encyclopedia.world_address_copied') : short}</span>
    </button>
  )
}

function WorldDetail({
  world,
  on_select_mob,
  on_select_item,
}: {
  world: WorldRow
  on_select_mob?: (id: string) => void
  on_select_item?: (id: string) => void
}) {
  const { t } = useTranslation()
  const has_roster_data = world.mobs !== undefined || world.resources !== undefined
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 w-[64px] h-[64px] border border-cyan/30 flex items-center justify-center"
          style={{ background: 'rgba(74,158,255,0.06)' }}
        >
          <Globe2 size={26} className="text-cyan opacity-70" />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[13px] tracking-[0.15em] uppercase font-semibold text-gradient">{world.name}</span>
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted">{world.biome}</span>
          <span className="text-[10px] tracking-wide" style={{ color: '#6b7280' }}>
            {world.band
              ? t('encyclopedia.level_range', { min: world.band[0], max: world.band[1] })
              : t('encyclopedia.world_level_unknown')}
          </span>
          {world.address && <WorldAddress address={world.address} />}
        </div>
      </div>
      {world.description && <div className="text-muted text-[10px] leading-relaxed italic">{world.description}</div>}

      <SectionDivider />
      <div className="flex flex-col gap-2">
        <SectionTitle title={t('encyclopedia.world_mob_roster')} />
        {world.mobs && world.mobs.length > 0 ? (
          <div className="flex flex-col gap-1">
            {world.mobs.map((m) => (
              <RosterChip key={m.id} mob={m} on_click={on_select_mob ? () => on_select_mob(m.id) : undefined} />
            ))}
          </div>
        ) : (
          <span className="text-[9px] tracking-[0.1em] uppercase italic text-muted">
            {has_roster_data ? t('encyclopedia.world_no_mobs') : t('encyclopedia.world_gap_note')}
          </span>
        )}
      </div>

      <SectionDivider />
      <div className="flex flex-col gap-2">
        <SectionTitle title={t('encyclopedia.world_resources')} />
        {world.resources && world.resources.length > 0 ? (
          <div className="flex flex-col gap-1">
            {world.resources.map((r) => (
              <ResourceChip
                key={r.id}
                resource={r}
                on_click={on_select_item ? () => on_select_item(r.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <span className="text-[9px] tracking-[0.1em] uppercase italic text-muted">
            {has_roster_data ? t('encyclopedia.world_no_resources') : t('encyclopedia.world_gap_note')}
          </span>
        )}
      </div>

      {world.dungeon && (
        <>
          <SectionDivider />
          <div className="flex flex-col gap-2">
            <SectionTitle title={t('encyclopedia.world_dungeon')} />
            <div className="flex items-center gap-2 text-[9px] tracking-[0.15em] uppercase text-gold mb-1">
              <DoorOpen size={11} className="opacity-60" />
              {world.dungeon.key ?? t('encyclopedia.world_dungeon')}
            </div>
            {world.dungeon.rooms.map((room, idx) => (
              <div
                key={idx}
                className="flex flex-col gap-1 pl-3"
                style={{ borderLeft: '2px solid rgba(200,150,60,0.2)' }}
              >
                <span className="text-[8px] tracking-[0.2em] uppercase text-muted">
                  {t('encyclopedia.world_dungeon_room', { n: idx + 1 })}
                </span>
                {room.mobs.map((m) => (
                  <RosterChip key={m.id} mob={m} on_click={on_select_mob ? () => on_select_mob(m.id) : undefined} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function WorldTab({
  worlds,
  loading,
  is_mobile,
  selected_world_id,
  on_select_world,
  on_select_mob,
  on_select_item,
}: {
  worlds: WorldRow[]
  loading?: boolean
  is_mobile: boolean
  selected_world_id: string | null
  on_select_world: (id: string | null) => void
  on_select_mob?: (id: string) => void
  on_select_item?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [params, set_params] = useSearchParams()
  // Search: instant input + deferred filter term + debounced ?q= (shared home) — see use_deferred_search.
  const { value: search_input, set_value: set_search_input, term: search } = use_deferred_search()
  const biome = params.get('biome') || 'ALL'
  const sort = (params.get('sort') || 'band_asc') as SortOption

  const update_param = (key: string, value: string) => {
    set_params(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || value === 'ALL' || value === 'band_asc') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true }
    )
  }

  const biomes = useMemo(() => [...new Set(worlds.map((w) => w.biome).filter(Boolean))].sort(), [worlds])

  const filtered = useMemo(() => {
    let out = worlds
    if (search) out = out.filter((w) => normalize_search(w.name).includes(normalize_search(search)))
    if (biome !== 'ALL') out = out.filter((w) => w.biome === biome)
    return [...out].sort((a, b) => {
      if (sort === 'name_asc') return a.name.localeCompare(b.name)
      return (a.band?.[0] ?? 0) - (b.band?.[0] ?? 0)
    })
  }, [worlds, search, biome, sort])

  const selected_world = useMemo(
    () => (selected_world_id ? (worlds.find((w) => w.id === selected_world_id) ?? null) : null),
    [worlds, selected_world_id]
  )

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <DetailLoading />
      </div>
    )
  }

  if (worlds.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
        <Globe2 size={24} style={{ opacity: 0.2 }} />
        <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.no_worlds')}</span>
      </div>
    )
  }

  const filter_bar = (
    <div className="flex flex-col gap-2 p-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30 pointer-events-none" />
          <input
            className="template-input w-full"
            placeholder={t('encyclopedia.search_worlds')}
            value={search_input}
            onChange={(e) => set_search_input(e.target.value)}
            style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', paddingLeft: 36 }}
          />
        </div>
        <span className="text-[8px] tracking-[0.15em] uppercase text-muted shrink-0">
          {t('encyclopedia.showing_count', { count: filtered.length, total: worlds.length })}
        </span>
        <select
          className="template-input cursor-pointer shrink-0"
          style={{ fontSize: 9, width: 'auto', minWidth: 100 }}
          value={sort}
          onChange={(e) => update_param('sort', e.target.value)}
        >
          <option value="band_asc">{t('encyclopedia.sort_level_asc')}</option>
          <option value="name_asc">{t('encyclopedia.sort_name')}</option>
        </select>
      </div>
      {biomes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={`category-pill ${biome === 'ALL' ? 'active' : ''}`}
            onClick={() => update_param('biome', '')}
          >
            {t('encyclopedia.view_all')}
          </button>
          {biomes.map((b) => (
            <button
              key={b}
              type="button"
              className={`category-pill ${biome === b ? 'active' : ''}`}
              style={{ fontSize: 8, padding: '2px 8px' }}
              onClick={() => update_param('biome', biome === b ? '' : b)}
            >
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const list = (
    <div className="flex-1 overflow-y-auto min-h-0">
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
          <Search size={16} style={{ opacity: 0.3 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.no_results')}</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map((w) => (
            <WorldCard
              key={w.id}
              world={w}
              is_selected={selected_world_id === w.id}
              on_select={() => on_select_world(w.id)}
            />
          ))}
        </div>
      )}
    </div>
  )

  const detail_panel = (
    <div className={`flex-1 overflow-y-auto ${is_mobile ? 'p-3' : 'p-4 pt-14'}`}>
      {!selected_world ? (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
          <Sparkles size={24} style={{ opacity: 0.2 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.select_world')}</span>
        </div>
      ) : (
        <WorldDetail world={selected_world} on_select_mob={on_select_mob} on_select_item={on_select_item} />
      )}
    </div>
  )

  if (is_mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {selected_world ? (
          <>
            <button
              type="button"
              onClick={() => on_select_world(null)}
              className="flex items-center gap-2 px-3 py-2 text-muted text-[10px] tracking-[0.15em] uppercase hover:text-gold transition-colors border-b border-border shrink-0 cursor-pointer"
            >
              <ArrowLeft size={12} /> {t('encyclopedia.back_to_list')}
            </button>
            {detail_panel}
          </>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {filter_bar}
            {list}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0">
      <div className={`flex flex-col min-w-0 min-h-0 ${selected_world ? 'flex-[7]' : 'flex-1'}`}>
        {filter_bar}
        {list}
      </div>
      {selected_world && (
        <div className="flex-[3] min-w-[380px] overflow-y-auto border-l border-border">{detail_panel}</div>
      )}
    </div>
  )
}
