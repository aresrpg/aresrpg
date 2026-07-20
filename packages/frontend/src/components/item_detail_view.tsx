// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Dice5, PackageX } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { use_content } from '../pages/encyclopedia/content'
import { use_template_t } from '../i18n/template_t'

import { ItemImage } from './items'
import {
  STAT_COLORS,
  ELEMENT_COLORS,
  CATEGORY_COLORS,
  stat_color_key,
  stat_label,
  sort_stat_entries,
} from './entity_colors'
import { is_new_template, NewBadge } from './entity_new_badge'
import { SectionDivider, SectionTitle } from './entity_section'

// --- ConsumableEffectLine ---

export function ConsumableEffectLine({
  effect,
  on_item_click,
}: {
  effect: { type: string; [key: string]: any }
  on_item_click?: (template_id: string) => void
}) {
  const { t } = useTranslation()
  const tt = use_template_t()
  // Consumable-referenced item names resolve from the seeded content catalog (was the dead WS templates.item).
  const templates_item = use_content().templates.item
  switch (effect.type) {
    case 'RESET_STATS':
      return (
        <div className="text-[10px] tracking-wide" style={{ color: '#b366ff' }}>
          {t('entity.reset_stats')}
        </div>
      )
    case 'RESET_SPELLS':
      return (
        <div className="text-[10px] tracking-wide" style={{ color: '#00cccc' }}>
          {t('entity.reset_spells')}
        </div>
      )
    case 'LIFE_REGEN': {
      const color = '#ff66b2'
      const instant = !effect.duration || effect.duration <= 0
      return (
        <div className="text-[10px] tracking-wide" style={instant ? { color } : undefined}>
          {instant ? (
            // D240 — explicit "Restores N HP" so a potion answers "how much does it grant?" at a glance
            // (was a bare "+N HP" stat-style line). One tinted string, mirroring the soul/regen effect lines.
            <span>{t('entity.restore_hp_effect', { amount: effect.amount })}</span>
          ) : (
            <span>{t('entity.health_regen_effect', { amount: effect.amount, duration: effect.duration })}</span>
          )}
        </div>
      )
    }
    case 'STAMINA_REGEN': {
      const color = '#ffcc00'
      const instant = !effect.duration || effect.duration <= 0
      return (
        <div className="text-[10px] tracking-wide">
          {instant ? (
            <>
              <span style={{ color }}>+{effect.amount}</span>
              <span style={{ color: '#AAAAAA' }}> Stamina</span>
            </>
          ) : (
            <span>{t('entity.stamina_regen_effect', { amount: effect.amount, duration: effect.duration })}</span>
          )}
        </div>
      )
    }
    case 'SOUL_REGEN': {
      return (
        <div className="text-[10px] tracking-wide" style={{ color: '#aad4ff' }}>
          {t('entity.soul_effect', { amount: effect.amount })}
        </div>
      )
    }
    case 'ADD_STATS': {
      const ck = stat_color_key(effect.stat || '')
      const color = STAT_COLORS[ck] || '#e8e4dc'
      const label = stat_label(t, effect.stat || '')
      return (
        <div className="text-[10px] tracking-wide" style={{ color }}>
          {t('entity.add_stats_effect', { amount: effect.amount, stat: label, duration: effect.duration })}
        </div>
      )
    }
    case 'RANDOM_ITEMS': {
      const rolls: { template_id: string; weight: number; quantity?: number }[] = effect.rolls || []
      const total_weight = rolls.reduce((sum, r) => sum + (r.weight || 0), 0)
      if (!rolls.length || !total_weight) return null
      const items = templates_item || []
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Dice5 size={10} className="text-cyan/60" />
            <span className="text-[9px] tracking-[0.15em] uppercase text-cyan/80 font-semibold">
              {t('entity.random_item')}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {rolls
              .sort((a, b) => b.weight - a.weight)
              .map((roll) => {
                const tmpl = items.find((t: any) => t.id === roll.template_id)
                const name = tmpl ? tt(tmpl, 'name') : roll.template_id.replace(/_/g, ' ')
                // NO quality tiers — roll rows render in the neutral body tone.
                const color = '#e8e4dc'
                const pct = ((roll.weight / total_weight) * 100).toFixed(1)
                const appearance = tmpl?.appearance || undefined
                return (
                  <div
                    key={roll.template_id}
                    className={`flex items-center gap-2 px-2 py-1.5 ${on_item_click ? 'cursor-pointer' : ''}`}
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                    onClick={on_item_click ? () => on_item_click(roll.template_id) : undefined}
                    onMouseEnter={
                      on_item_click
                        ? (e) => {
                            ;(e.currentTarget as HTMLElement).style.background = 'rgba(200,150,60,0.08)'
                          }
                        : undefined
                    }
                    onMouseLeave={
                      on_item_click
                        ? (e) => {
                            ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'
                          }
                        : undefined
                    }
                  >
                    <ItemImage
                      id={roll.template_id}
                      appearance={appearance}
                      className="w-5 h-5 object-contain shrink-0"
                    />
                    <span className="text-[9px] tracking-[0.1em] uppercase flex-1 truncate" style={{ color }}>
                      {name}
                    </span>
                    {(roll.quantity ?? 1) > 1 && (
                      <span className="text-[9px] tracking-wide shrink-0 font-mono text-gold">×{roll.quantity}</span>
                    )}
                    <span className="text-[9px] tracking-wide shrink-0 font-mono" style={{ color: '#6b7280' }}>
                      {pct}%
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )
    }
    default:
      return null
  }
}

// --- RemovedItemNotice ---

/**
 * The graceful state an owned item shows once its ItemTemplate has been DELETED on-chain — the copy reads
 * "this item was removed from the game, please crush it for runes". The ONE presentational
 * home for that copy — shared by the inventory hover tooltip (entity_tooltip) and the crush confirm modal
 * (crush_menu). A distinct placeholder glyph (the house lucide idiom, muted gold) stands in for the missing
 * art; stats are hidden (there is no template to range them against), CRUSH stays the offered action. `note`
 * carries the optional pending-upgrade line the crush modal shows while the on-chain orphan-crush door is
 * not yet live.
 */
export function RemovedItemNotice({ note }: { note?: string }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center text-center gap-2 py-1"
      style={{ fontFamily: 'JetBrains Mono, monospace' }}
    >
      <PackageX size={28} strokeWidth={1.5} style={{ color: '#c8963c', opacity: 0.55 }} aria-hidden="true" />
      <span className="text-[11px] tracking-[0.14em] uppercase" style={{ color: '#c8963c' }}>
        {t('removed_item.name')}
      </span>
      <span className="text-[10px] tracking-[0.08em]" style={{ color: '#6b7280' }}>
        {t('removed_item.subtitle')}
      </span>
      {note && (
        <span className="text-[9px] tracking-[0.05em] mt-0.5" style={{ color: '#6b7280', fontStyle: 'italic' }}>
          {note}
        </span>
      )}
    </div>
  )
}

// --- ItemDetailView ---

interface ItemDetailImageProps {
  id: string
  image_url?: string
  appearance?: string
  category: string
}

/**
 * React identity for the focused icon. ItemImage owns a stateful fallback cursor; keeping that component mounted
 * while the detail pane changes lets the old decoded pixels survive into the next item. Identity includes every
 * candidate-defining field so A -> B -> A always creates a fresh image node instead of reusing either fallback run.
 */
export const item_detail_image_key = ({ id, image_url, appearance, category }: ItemDetailImageProps) =>
  `${id}\u0000${image_url ?? ''}\u0000${appearance ?? ''}\u0000${category}`

export function ItemDetailImage({ item }: { item: ItemDetailImageProps }) {
  return (
    <ItemImage
      key={item_detail_image_key(item)}
      id={item.id}
      image_url={item.image_url}
      appearance={item.appearance}
      category={item.category}
      className="w-18 h-18 object-contain"
      style={{ filter: 'drop-shadow(0 0 8px rgba(200,150,60,0.3))' }}
      hd
      // eager: this is the ONE focused image in the pane — load it (and run its HD→base fallback)
      // on open, so an item whose _hd art is missing flips to the base icon immediately instead of
      // flashing an empty slot while a lazy load waits to trigger.
      eager
    />
  )
}

/** Marketcap = supply × last per-unit sale price, formatted in SUI with 2 decimals. BigInt end to
 * end: supply (u64 units) × price (MIST string) overflows Number well within realistic ranges
 * (3000 × 500 SUI is already ~1.5e15 MIST). Floors to hundredths of SUI. */
function format_marketcap_sui(supply: number, last_sale_mist: string): string {
  const hundredths = (BigInt(supply) * BigInt(last_sale_mist)) / 10_000_000n // MIST → SUI/100
  const int = hundredths / 100n
  const frac = (hundredths % 100n).toString().padStart(2, '0')
  return `${Number(int).toLocaleString()}.${frac} SUI`
}

export function ItemDetailView({
  item,
  children,
  on_item_click,
}: {
  item: {
    id?: string
    /** DISPLAY-FIRST: on-chain Display image_url, wins over the slug-built icon (see ItemImage). */
    image_url?: string
    appearance?: string
    name: string
    category: string
    rarity: string
    level: number
    createdAt?: number | string
    damages: { element: string; from: number; to: number; damage_type?: string }[]
    stats: Record<string, number | [number, number]>
    description?: string
    consumable_effect?: { type: string; [key: string]: any } | null
    /** Legacy catalog metadata. It is not a verified character gate and is intentionally not rendered as one. */
    weapon_class?: string
    particle_trail?: { particleId: string; scale: number; color: string } | null
    /** OBTENTION HONESTY (the encyclopedia showed empty recipe/drop sections with no summary
     * telling the player HOW to get the item). Derived from what the encyclopedia already reads for this
     * item (dropped_by cross-ref, catalog recipeJson, live /v1/shop sales) — omitted (undefined/null) on
     * every non-encyclopedia ItemDetailView caller, same opt-in shape as `taux` above. */
    obtention?: { dropped_count: number; has_recipe: boolean; sold_in_shop: boolean } | null
    /** Live on-chain supply (indexer feature — /v1/encyclopedia items[].supply, HANDLERS.md "Item
     * supply"): the total amount of this template still alive on chain. Encyclopedia-only opt-in,
     * same shape as `obtention` — undefined on every other ItemDetailView caller (marketplace,
     * inventory, scribe), so the under-icon stat block renders only where the fact is meaningful. */
    supply?: number
    /** Last realised per-unit sale price in MIST (string — 2^53 money law), from
     * /v1/encyclopedia items[].last_sale_mist (HANDLERS.md "Last sale": shop / pool / kiosk
     * marketplace, zero-price extract-seam purchases excluded). null until the template's FIRST
     * sale ever → the marketcap line renders the documented "unknown". Rides with `supply`
     * (marketcap = supply × this), so it only renders where supply does. */
    last_sale_mist?: string | null
  }
  children?: ReactNode
  on_item_click?: (template_id: string) => void
}) {
  const { t } = useTranslation()
  const obtention_line = (() => {
    if (!item.obtention) return null
    const { dropped_count, has_recipe, sold_in_shop } = item.obtention
    const parts: string[] = []
    if (dropped_count > 0) parts.push(t('encyclopedia.obtention_dropped_by', { count: dropped_count }))
    if (has_recipe) parts.push(t('encyclopedia.obtention_crafted'))
    if (sold_in_shop) parts.push(t('encyclopedia.obtention_shop'))
    return parts.length > 0 ? parts.join(' · ') : t('encyclopedia.obtention_unknown')
  })()
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-start gap-4">
        {(item.id || typeof item.supply === 'number') && (
          <div className="flex flex-col gap-1.5 shrink-0">
            {item.id && (
              <ItemDetailImage
                item={{
                  id: item.id,
                  image_url: item.image_url,
                  appearance: item.appearance,
                  category: item.category,
                }}
              />
            )}
            {/* On-chain market stats under the icon (deliberate placement — "not a characteristic") —
                supply + marketcap, encyclopedia-only (rides the `supply` opt-in). */}
            {typeof item.supply === 'number' && (
              <div className="flex flex-col gap-0.5 text-[8px] tracking-[0.1em] uppercase whitespace-nowrap">
                <span style={{ color: '#6b7280' }}>
                  {t('encyclopedia.total_supply')}{' '}
                  <span style={{ color: '#c8a861' }}>{item.supply.toLocaleString()}</span>
                </span>
                <span style={{ color: '#6b7280' }}>
                  {t('encyclopedia.marketcap')}{' '}
                  {item.last_sale_mist ? (
                    <span style={{ color: '#c8a861' }}>{format_marketcap_sui(item.supply, item.last_sale_mist)}</span>
                  ) : (
                    // No sale has EVER happened for this template (last_sale_mist null) — render an
                    // honest "unknown", never a fabricated 0.
                    <span style={{ color: '#6b7280', fontStyle: 'italic' }}>{t('encyclopedia.marketcap_unknown')}</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            {/* NO quality tiers, ever — no rarity chip, no rarity tint. */}
            <span className="text-[13px] tracking-[0.15em] uppercase font-semibold text-gold">{item.name}</span>
            {is_new_template(item.createdAt) && <NewBadge />}
            {/* No "Lv. 0" — cosmetics (and any level-less item) carry no level, so a level line
                there is a lie. Render it only for a real level (≥1). */}
            {item.level > 0 && (
              <span className="text-[10px] tracking-wide ml-auto" style={{ color: '#6b7280' }}>
                {t('entity.level_short', { level: item.level })}
              </span>
            )}
          </div>
          <span
            className="text-[10px] tracking-[0.15em] uppercase"
            style={{ color: CATEGORY_COLORS[item.category] || '#6b7280' }}
          >
            {t(`entity.category.${item.category.toLowerCase()}`, { defaultValue: item.category })}
          </span>
          {item.description && (
            <span className="text-[9px] leading-relaxed mt-1" style={{ color: '#777', fontStyle: 'italic' }}>
              {item.description}
            </span>
          )}
        </div>
      </div>
      {/* Obtention (honest summary — never mute) */}
      {obtention_line && (
        <div className="text-[9px] tracking-[0.05em]" style={{ color: '#6b7280' }}>
          {obtention_line}
        </div>
      )}
      {/* Separator */}
      <SectionDivider />
      {/* Characteristics */}
      <div className="flex flex-col gap-2">
        <SectionTitle title={t('entity.characteristics')} />
        {/* Damages */}
        {item.damages.length > 0 && (
          <div className="flex flex-col gap-1">
            {item.damages.map((d, i) => {
              const el_color = ELEMENT_COLORS[d.element] || '#ffffff'
              const label = d.damage_type === 'life_steal' ? t('entity.life_steal') : t('entity.damages')
              return (
                <div key={i} className="text-[10px] tracking-wide">
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
        {/* Stats */}
        {Object.entries(item.stats).filter(([, v]) => (Array.isArray(v) ? v[0] !== 0 || v[1] !== 0 : v !== 0)).length >
          0 && (
          <div className="flex flex-col gap-0.5">
            {sort_stat_entries(
              Object.entries(item.stats).filter(([, v]) => (Array.isArray(v) ? v[0] !== 0 || v[1] !== 0 : v !== 0))
            ).map(([key, val], idx) => {
              const [min_value, max_value] = Array.isArray(val) ? val : [val, val]
              const is_range = min_value !== max_value
              const ck = stat_color_key(key)
              const stat_color = STAT_COLORS[ck] || '#e8e4dc'
              const num_color = (n: number) => (n < 0 ? '#FF5555' : stat_color)
              const num_prefix = (n: number) => (n < 0 ? '' : '+')
              return (
                <div
                  key={key}
                  className="text-[10px] tracking-wide px-2 py-1"
                  style={{ background: idx % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent' }}
                >
                  {is_range ? (
                    <>
                      <span style={{ color: num_color(min_value) }}>
                        {num_prefix(min_value)}
                        {min_value}
                      </span>
                      <span style={{ color: '#AAAAAA' }}> {t('entity.range_to')} </span>
                      <span style={{ color: num_color(max_value) }}>{max_value}</span>
                      <span style={{ color: '#AAAAAA' }}> </span>
                      <span style={{ color: stat_color }}>{stat_label(t, key)}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: num_color(min_value) }}>
                        {num_prefix(min_value)}
                        {min_value}
                      </span>
                      <span style={{ color: '#AAAAAA' }}> </span>
                      <span style={{ color: stat_color }}>{stat_label(t, key)}</span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {/* Particle Trail Effect */}
        {item.particle_trail && (
          <div
            className="text-[10px] tracking-wide px-2 py-1 flex items-center gap-2"
            style={{ background: 'rgba(200,150,60,0.05)' }}
          >
            <span style={{ color: '#c8963c' }}>✦</span>
            <span style={{ color: '#c8963c', fontStyle: 'italic' }}>{t('entity.particle_trail_effect')}</span>
          </div>
        )}
        {/* Consumable Effect */}
        {item.consumable_effect && (
          <div className="px-2 py-1">
            <ConsumableEffectLine effect={item.consumable_effect} on_item_click={on_item_click} />
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
