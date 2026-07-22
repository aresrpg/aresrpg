// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Crown,
  Shirt,
  Gem,
  CircleDot,
  Minus,
  Footprints,
  Swords,
  Shield,
  Cat,
  Sparkles,
  Star,
  Rabbit,
} from 'lucide-react'
import { canonical_walrus_asset_url, item_icon_url, walrus_asset_url, ASSET_BASE } from '@aresrpg/sdk/jobs'

import { use_image_version } from '../stores/image_version'
import { use_content } from '../pages/encyclopedia/content'
import { type ItemInfo } from '../types/chain'
import { safe_json_parse } from '../safe_json_parse'
import { use_template_t } from '../i18n/template_t'
import { display_rolled_stats } from '../chain/rolled_stats.js'
// Rarity SSOT: QUALITY_COLOR-derived tint + hue (quality.js) so an item's rarity reads the SAME here as
// on every HUD surface. Replaces the old whitish RARITY_COLORS border with a per-tier inset radial tint.
import { quality_color, rarity_tint } from '../game/screens/hud/quality'
// D133: the terminal fallback glyph family — ONE home (ItemIcon.jsx owns the category→icon map). The bag
// already degrades to a category glyph (the accepted flask fallback); ItemImage surfaces (shop/marketplace)
// previously degraded to visibility:hidden = a BLANK slot on the sale card.
import { item_fallback_glyph } from '../game/screens/hud/ItemIcon.jsx'

import {
  RARITY_COLORS,
  STAT_COLORS,
  ELEMENT_COLORS,
  STAT_LABEL_KEYS,
  format_stat_name,
  stat_color_key,
  sort_stat_entries,
  ConsumableEffectLine,
} from './entity_display'

export function ItemImage({
  id,
  image_url,
  appearance,
  category,
  className,
  style,
  hd,
  eager,
}: {
  id: string
  /** DISPLAY-FIRST: the on-chain Display `image_url` (wallet-grade, instance-correct). When present it wins;
   * the slug-built URL is only the fallback for reads that can't resolve Display (kiosk-wrapped/nested). */
  image_url?: string
  appearance?: string
  /** D133: when every image candidate 404s, render this category's glyph (the bag's accepted degradation)
   * instead of a blank slot. Omit ⇒ legacy hidden behavior (surfaces that layer their own placeholder). */
  category?: string | null
  className?: string
  style?: React.CSSProperties
  hd?: boolean
  eager?: boolean
}) {
  const v = use_image_version((s) => s.image_versions[id])
  const [exhausted, set_exhausted] = useState(false)
  // ONE item-URL home: the SDK resolver owns Walrus shard selection, host-free fallback, HD naming, and the
  // object-address guard. A bad runtime key is an honest missing candidate here, never a render-time crash.
  const resolve_icon = (high_definition: boolean) => {
    try {
      return item_icon_url(id, { hd: high_definition })
    } catch {
      return null
    }
  }
  const icon_url = resolve_icon(!!hd)
  // hd callers (the shop vitrines) degrade to the BASE icon before vanilla/glyph — an id whose _hd art isn't
  // published must still show its own icon. The onLoad hook below re-pixelates when a base png actually lands.
  const icon_url_base = hd ? resolve_icon(false) : null
  const vanilla_url = appearance
    ? (walrus_asset_url('vanilla', `${appearance}.png`) ?? `${ASSET_BASE}/vanilla/${appearance}.png`)
    : null
  // HD DETAIL ("the detail page still points to /items/<slug>.png, not the _hd variant"): a
  // Display `image_url` is the BASE `.png`, so when it's present it used to win the whole race and the _hd
  // variant was never requested. In hd mode, derive the `_hd.png` twin of the Display url and try it FIRST; the
  // base Display url stays right behind it, so a missing _hd object (server-side 404 — most items today) flips
  // straight back to the base render. Skipped when the url isn't a `.png` or is already an _hd url.
  // A chain Display may already carry a Walrus blob path. Re-home it through the configured manifest base so
  // a Display published with a raw origin cannot bypass the app CDN. Host-free/data URLs stay local; any other
  // absolute host is discarded and the manifest-backed slug builder below wins.
  const display_url =
    image_url?.startsWith('/') || image_url?.startsWith('data:') ? image_url : canonical_walrus_asset_url(image_url)
  const image_url_hd =
    hd && display_url && /\.png(\?|$)/i.test(display_url) && !/_hd\.png/i.test(display_url)
      ? display_url.replace(/\.png(\?|$)/i, '_hd.png$1')
      : null
  // Ordered fallback: (hd) Display _hd → canonical Display url → slug icon (→ base icon when hd) →
  // vanilla appearance → hidden.
  const candidates = [image_url_hd, display_url, icon_url, icon_url_base, vanilla_url].filter(Boolean) as string[]
  const base = candidates[0] ?? null
  const primary = base && v ? `${base}?v=${v}` : base
  // Advance the ordered fallback (Display url → slug icon → vanilla appearance → hidden). Shared by
  // onError (404 / blocked) AND onLoad-with-naturalWidth-0: a CDN/SW response that resolves HTTP-ok with an
  // undecodable body (Cloudflare error page, opaque SW cache) fires onLOAD — never onError — and leaks the
  // browser's native broken-image box (a WHITE BORDER + a top-left SQUARE placeholder). ItemIcon.jsx guards
  // this exact case (#22b); ItemImage is its sibling root, so every ItemImage surface (shop / marketplace /
  // loot-roll pickers / the shared onchain hover tooltip over the bag + equipment) inherits the guard here. (D11)
  const advance = (img: HTMLImageElement) => {
    const next = Number(img.dataset.fbidx ?? '0') + 1
    if (next < candidates.length) {
      img.dataset.fbidx = String(next)
      img.src = candidates[next]
    } else {
      img.style.visibility = 'hidden' // same-tick belt-and-braces; the glyph branch below re-renders
      set_exhausted(true)
    }
  }
  // Every candidate failed (or the resolver rejected an object address): use the shared semantic/category
  // placeholder, with its generic package glyph as the final fallback. No item icon surface may stay blank.
  const glyph = exhausted || !primary ? item_fallback_glyph(category) : null
  if (glyph)
    return (
      <span
        className={`inline-flex items-center justify-center text-muted opacity-60 ${className ?? ''}`}
        style={style}
        aria-hidden="true"
      >
        {glyph}
      </span>
    )
  return (
    <img
      src={primary ?? undefined}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      referrerPolicy="no-referrer"
      className={className}
      style={{ ...(hd ? {} : { imageRendering: 'pixelated' as const }), ...style }}
      data-fbidx="0"
      onError={(e) => advance(e.currentTarget)}
      onLoad={(e) => {
        if (!e.currentTarget.naturalWidth) advance(e.currentTarget)
        // hd request resolved onto a non-hd candidate (base/local/vanilla): a small pixel-art png scaled large
        // must render pixelated, not smoothed to mush.
        else if (hd && !/_hd\./.test(e.currentTarget.currentSrc)) e.currentTarget.style.imageRendering = 'pixelated'
      }}
    />
  )
}

export function ItemTooltipContent({ item }: { item: ItemInfo }) {
  const { t } = useTranslation()
  const tt = use_template_t()
  const { templates } = use_content()
  const rarity_color = RARITY_COLORS[item.rarity] || RARITY_COLORS.common
  const tmpl = (templates.item || []).find((tmpl: any) => tmpl.id === item.template_id)
  const display_name = tmpl ? tt(tmpl, 'name') : item.name || item.template_id.replace(/_/g, ' ')
  const resolved_description = tmpl ? tt(tmpl, 'description') : item.description
  const stats = safe_json_parse(item.stats_json, {})
  const stat_entries = Object.entries(stats).filter(([, v]) => (Array.isArray(v) ? v[0] !== 0 || v[1] !== 0 : v !== 0))
  const damages: { element: string; from: number; to: number; damage_type: string }[] = safe_json_parse(
    item.damages_json,
    []
  )
  const consumable_effect = safe_json_parse(item.consumable_json, null)
  const pet_max_stats: Record<string, number> = safe_json_parse(item.pet_stats_json, {})
  const pet_power_pct = item.pet_power > 0 || Object.keys(pet_max_stats).length > 0 ? item.pet_power / 10_000 : null

  return (
    <div
      className="pointer-events-none z-50"
      style={{
        // D11 (design SSOT): rarity is a top-weighted inset radial tint over the dark base — NOT a border
        // (the old `${rarity_color}4d` read whitish on `common`) and NO rarity outer box. Structural edge
        // is a neutral hairline. Name text keeps its rarity colour below.
        background: `${rarity_tint(item.rarity)}, var(--color-bg)`,
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '12px 16px',
        maxWidth: 280,
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] tracking-[0.15em] uppercase font-semibold" style={{ color: rarity_color }}>
          {display_name}
        </span>
        {item.level > 0 && (
          <span className="text-[9px] tracking-wide shrink-0" style={{ color: rarity_color, opacity: 0.7 }}>
            Lvl {item.level}
          </span>
        )}
      </div>
      {item.category && <div className="text-[9px] tracking-[0.1em] uppercase mt-0.5 text-muted">{item.category}</div>}
      {pet_power_pct !== null && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] tracking-wide" style={{ color: '#a8e6cf' }}>
            Pet Power
          </span>
          <div className="flex-1 h-1 rounded-full" style={{ background: '#1a2e1a' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(pet_power_pct, 100)}%`,
                background: pet_power_pct >= 100 ? '#fbbf24' : '#4ade80',
              }}
            />
          </div>
          <span className="text-[9px] font-mono" style={{ color: pet_power_pct >= 100 ? '#fbbf24' : '#4ade80' }}>
            {pet_power_pct.toFixed(1)}%
          </span>
        </div>
      )}
      {resolved_description && <div className="text-[9px] mt-2 leading-relaxed text-muted">{resolved_description}</div>}
      {damages.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-2">
          {damages.map((d, i) => {
            const el_color = ELEMENT_COLORS[d.element] || '#ffffff'
            const label = d.damage_type === 'life_steal' ? 'life steal' : 'damages'
            return (
              <div key={i} className="text-[10px]">
                <span style={{ color: el_color }}>{d.from}</span>
                <span style={{ color: '#AAAAAA' }}> - </span>
                <span style={{ color: el_color }}>{d.to}</span>
                <span style={{ color: '#AAAAAA' }}> {label} </span>
                <span style={{ color: el_color }}>{d.element}</span>
              </div>
            )
          })}
        </div>
      )}
      {stat_entries.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-2">
          {sort_stat_entries(stat_entries).map(([key, val]) => {
            const is_range = Array.isArray(val)
            const color_key = stat_color_key(key)
            const stat_color = STAT_COLORS[color_key] || '#e8e4dc'
            const is_negative = is_range ? val[1] < 0 : (val as number) < 0
            return (
              <div key={key} className="text-[10px]">
                {is_range ? (
                  is_negative ? (
                    <span style={{ color: '#FF5555' }}>
                      {val[0]} to {val[1]} {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                    </span>
                  ) : (
                    <>
                      <span style={{ color: '#AAAAAA' }}>+</span>
                      <span style={{ color: stat_color }}>{val[0]}</span>
                      <span style={{ color: '#AAAAAA' }}> to </span>
                      <span style={{ color: stat_color }}>{val[1]}</span>
                      {pet_max_stats[key] != null && (
                        <span style={{ color: stat_color, opacity: 0.4 }}> / {pet_max_stats[key]}</span>
                      )}
                      <span style={{ color: '#AAAAAA' }}> </span>
                      <span style={{ color: stat_color }}>
                        {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                      </span>
                    </>
                  )
                ) : (val as number) < 0 ? (
                  <span style={{ color: '#FF5555' }}>
                    {val as number} of {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                  </span>
                ) : (
                  <>
                    <span style={{ color: '#AAAAAA' }}>+</span>
                    <span style={{ color: stat_color }}>{val as number}</span>
                    {pet_max_stats[key] != null ? (
                      <>
                        <span style={{ color: stat_color, opacity: 0.4 }}> / {pet_max_stats[key]}</span>
                        <span style={{ color: '#AAAAAA' }}> </span>
                        <span style={{ color: stat_color }}>
                          {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ color: '#AAAAAA' }}> of </span>
                        <span style={{ color: stat_color }}>
                          {t(STAT_LABEL_KEYS[key] ?? '', { defaultValue: format_stat_name(key) })}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      {consumable_effect && (
        <div className="mt-2">
          <ConsumableEffectLine effect={consumable_effect} />
        </div>
      )}
      {item.quantity > 1 && (
        <div className="flex gap-4 mt-2 text-[9px]">
          <span style={{ color: '#6b7280' }}>Qty: {item.quantity}</span>
        </div>
      )}
    </div>
  )
}

// Mouse-follow tooltip positioning, generic over the payload + renderer — the ONE hover-tooltip
// positioning engine every surface shares. `use_onchain_item_tooltip` (chain-direct ItemTemplate,
// findables/recall/inventory) is the wrapper in entity_display.tsx (kept there to avoid a circular
// import on ItemDetailView).
export function use_mouse_tooltip<T>(render: (item: T) => React.ReactNode) {
  const [visible, set_visible] = useState(false)
  const [pos, set_pos] = useState({ x: 0, y: 0 })
  const [item, set_item] = useState<T | null>(null)
  const tooltip_ref = useRef<HTMLDivElement>(null)

  const on_mouse_enter = useCallback((e: React.MouseEvent, target_item: T) => {
    set_item(target_item)
    set_pos({ x: e.clientX + 12, y: e.clientY + 12 })
    set_visible(true)
  }, [])

  const on_mouse_move = useCallback((e: React.MouseEvent) => {
    const tx = e.clientX + 12
    const ty = e.clientY + 12
    const tw = 296
    const th = tooltip_ref.current?.offsetHeight || 200
    const vw = window.innerWidth
    const vh = window.innerHeight
    set_pos({
      x: tx + tw > vw ? e.clientX - tw : tx,
      y: ty + th > vh ? e.clientY - th : ty,
    })
  }, [])

  const on_mouse_leave = useCallback(() => {
    set_visible(false)
    set_item(null)
  }, [])

  const tooltip_element =
    visible && item ? (
      <div
        ref={tooltip_ref}
        className="fixed pointer-events-none z-50 transition-opacity duration-150"
        style={{ left: pos.x, top: pos.y, opacity: visible ? 1 : 0 }}
      >
        {render(item)}
      </div>
    ) : null

  return { on_mouse_enter, on_mouse_move, on_mouse_leave, tooltip_element }
}

export function item_info_to_detail_props(
  item: ItemInfo,
  opts?: { templates?: any[]; tt?: (tmpl: any, field: 'name' | 'description') => string }
) {
  const stats = safe_json_parse(item.stats_json, {})
  const damages = safe_json_parse(item.damages_json, [])
  const tmpl = opts?.templates?.find((t: any) => t.id === item.template_id)
  const resolved_name =
    tmpl && opts?.tt
      ? opts.tt(tmpl, 'name') || item.name || item.template_id.replace(/_/g, ' ')
      : item.name || item.template_id.replace(/_/g, ' ')
  const resolved_desc =
    tmpl && opts?.tt ? opts.tt(tmpl, 'description') || item.description || undefined : item.description || undefined
  return {
    id: item.template_id,
    appearance: item.appearance || undefined,
    name: resolved_name,
    category: item.category,
    rarity: item.rarity,
    level: item.level,
    damages,
    stats,
    description: resolved_desc,
    consumable_effect: safe_json_parse(item.consumable_json, null),
    particle_trail: safe_json_parse(item.particle_trail_json, null),
    weapon_class: item.weapon_class || undefined,
  }
}

/**
 * DISPLAY-FIRST on-chain ItemTemplate → the ItemDetailView/ItemTooltipContent props shape. The SHARED
 * adapter for all 3 chain-direct surfaces (findables, recall result, inventory) — converges what used
 * to be per-surface ad-hoc shaping into one place. statsJson is already REAL-valued (decoded + neutrals
 * dropped by read_templates.js normalize_item_template — the single decode home); pass it straight through,
 * never re-decode here.
 * @param tmpl the normalize_item_template() shape: { id, name, item_type, category, level, pods, statsJson, display }
 * @param tt optional use_template_t() resolver — routes the description through the lazy item_desc
 *           catalog (keyed by the item_type SLUG; chain Display carries EN only) before falling back
 *           to the Display EN string. Callers are components/hooks, so each threads its own tt.
 */
export function onchain_template_to_detail_props(
  tmpl: {
    id?: string
    name?: string
    item_type?: string
    /** The RESOLVED icon slug when the caller knows one (Inventory threads inventory_item_icon — the same
     * home the bag cell paints with). Wins over item_type for the detail image: a cosmetic's on-chain
     * item_type is the generic slot word ('hat'/'cloak' → items/cloak.png 404 → no icon, night-batch #3). */
    icon_slug?: string | null
    category?: string
    level?: number
    statsJson?: string
    /** True only for a concrete owned instance. Owned surfaces never consume `statsJson` (the template range). */
    owned?: boolean
    /** The instance's centered-u16 StatsKey block from sdk.get_rolled_stats(item_id). It is decoded through the
     * one rolled-stat display home; null while unresolved/absent keeps the owned card honestly stat-empty. */
    rolled_stats?: Record<string, number> | null
    // D240: normalize_item_template's decoded heal effect ({ type:'LIFE_REGEN', amount } | null) — carried
    // through so the shared ItemDetailView shows "Restores N HP" on consumables (bag/findables/recall tooltips).
    consumable_effect?: { type: string; [key: string]: any } | null
    display?: { name?: string; image_url?: string; description?: string } | null
  },
  tt?: ReturnType<typeof use_template_t>
) {
  const parsed_stats = safe_json_parse<Record<string, number | [number, number]>>(tmpl.statsJson, {})
  const raw_stats = tmpl.owned ? display_rolled_stats(tmpl.rolled_stats) : parsed_stats
  const en_description = tmpl.display?.description || undefined
  return {
    id: tmpl.icon_slug || tmpl.item_type || tmpl.id,
    image_url: tmpl.display?.image_url || undefined,
    name: tmpl.display?.name || tmpl.name || (tmpl.item_type ?? '').replace(/_/g, ' '),
    category: tmpl.category ?? '',
    rarity: 'common',
    level: tmpl.level ?? 0,
    damages: [],
    stats: raw_stats,
    description: tt
      ? tt({ desc_key: tmpl.item_type, description: en_description }, 'description') || undefined
      : en_description,
    consumable_effect: tmpl.consumable_effect ?? null,
  }
}

const SLOT_ICONS: Record<string, any> = {
  HEAD: Crown,
  CHEST: Shirt,
  AMULET: Gem,
  RING1: CircleDot,
  RING2: CircleDot,
  BELT: Minus,
  FEET: Footprints,
  WEAPON: Swords,
  HANDS: Shield,
  PET: Cat,
  RELIC1: Sparkles,
  RELIC2: Sparkles,
  RELIC3: Sparkles,
  RELIC4: Sparkles,
  RELIC5: Sparkles,
  RELIC6: Sparkles,
  LEGS: Star,
  MOUNT: Rabbit,
}

export function ItemSlot({
  item,
  slot,
  selected,
  on_click,
  size = 48,
}: {
  item?: ItemInfo | null
  slot?: string
  selected?: boolean
  on_click?: () => void
  size?: number
}) {
  const rarity_color = item ? quality_color(item.rarity) : undefined
  const SlotIcon = slot ? SLOT_ICONS[slot] : null

  return (
    <button
      type="button"
      // D11: no stray light outline on a MOUSE click (avoid stray "white borders" on click); the keyboard
      // :focus-visible ring is preserved for a11y. Same guard the HUD cells carry, in the shared React cell.
      className="flex flex-col items-center justify-center transition-all cursor-pointer [&:focus:not(:focus-visible)]:outline-none"
      style={{
        width: size,
        height: size,
        // D11 (design SSOT): a FILLED cell carries NO resting rarity border — rarity is the top-weighted
        // inset radial tint (rarity_tint) over a dark base. Hover / is-selected still light a QUALITY_COLOR
        // edge for feedback. An EMPTY cell is a dark neutral square (no whitish outline / "white square").
        border: selected
          ? `1px solid ${rarity_color || 'rgba(200,150,60,0.6)'}`
          : item
            ? '1px solid transparent'
            : '1px dashed rgba(255,255,255,0.05)',
        background: selected
          ? `${rarity_color}12`
          : item
            ? `${rarity_tint(item.rarity)}, rgba(255,255,255,0.02)`
            : 'rgba(0,0,0,0.18)',
        boxShadow: selected ? `0 0 12px ${rarity_color}30` : 'none',
      }}
      onClick={on_click}
      onMouseEnter={(e) => {
        if (!selected && item) {
          ;(e.currentTarget as HTMLElement).style.borderColor = `${rarity_color}`
          ;(e.currentTarget as HTMLElement).style.boxShadow = `0 0 10px ${rarity_color}25`
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          ;(e.currentTarget as HTMLElement).style.borderColor = item ? 'transparent' : 'rgba(255,255,255,0.05)'
          ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
        }
      }}
    >
      {item ? (
        <div className="relative" style={{ width: size - 12, height: size - 12 }}>
          <ItemImage
            id={item.template_id}
            appearance={item.appearance}
            className="object-contain"
            style={{ width: size - 12, height: size - 12 }}
          />
          {item.quantity > 1 && (
            <span
              className="absolute bottom-0 right-0 text-[8px] font-semibold leading-none text-gold"
              style={{ textShadow: '0 0 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)' }}
            >
              {item.quantity}
            </span>
          )}
        </div>
      ) : (
        <>
          {SlotIcon && <SlotIcon size={14} className="text-muted" style={{ opacity: 0.2 }} />}
          {slot && (
            <span className="text-[7px] tracking-wide uppercase text-muted" style={{ opacity: 0.3 }}>
              {slot.replace(/\d+$/, '')}
            </span>
          )}
        </>
      )}
    </button>
  )
}
