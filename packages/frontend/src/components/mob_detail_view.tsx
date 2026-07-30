// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Heart, Sparkles, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { is_archi_tier } from '../game/data/mobs.js'
import { EncyclopediaMobImage } from '../pages/encyclopedia/mob_image'

import { STAT_COLORS, ELEMENT_COLORS, STAT_LABEL_KEYS, format_stat_name, stat_color_key } from './entity_colors'
import { ArchiBadge, is_new_template, NewBadge } from './entity_new_badge'
import { SectionDivider, SectionTitle } from './entity_section'

// --- FoundInWorldsSection ---

/** The clickable "FOUND IN" world list — ONE home for the idiom, shared by the bestiary detail (mob
 * spawn provenance) and the items detail (gatherable placement, night-batch #8). Renders nothing for an
 * empty list; rows deep-link via `on_navigate_to_world` when provided, else render inert. */
export function FoundInWorldsSection({
  worlds,
  on_navigate_to_world,
}: {
  worlds: { id: string; name: string; biome?: string }[] | null | undefined
  on_navigate_to_world?: (world_id: string) => void
}) {
  const { t } = useTranslation()
  if (!worlds || worlds.length === 0) return null
  return (
    <>
      <SectionDivider />
      <div className="flex flex-col gap-2">
        <SectionTitle title={t('encyclopedia.found_in')} />
        <div className="flex flex-col gap-1">
          {worlds.map((world) => (
            <button
              key={world.id}
              type="button"
              data-world-id={world.id}
              className="flex items-center gap-2 px-2 py-1.5 text-left disabled:cursor-default"
              style={{ background: 'rgba(255,255,255,0.02)' }}
              disabled={!on_navigate_to_world}
              onClick={on_navigate_to_world ? () => on_navigate_to_world(world.id) : undefined}
              onMouseEnter={
                on_navigate_to_world
                  ? (event) => {
                      event.currentTarget.style.background = 'rgba(200,150,60,0.08)'
                    }
                  : undefined
              }
              onMouseLeave={
                on_navigate_to_world
                  ? (event) => {
                      event.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                    }
                  : undefined
              }
            >
              <MapPin size={11} className="shrink-0 text-gold/60" />
              <span className="text-[10px] tracking-[0.1em] uppercase flex-1 text-gold">{world.name}</span>
              {world.biome && <span className="text-[8px] tracking-[0.12em] uppercase text-muted">{world.biome}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

// --- MobDetailView ---

export function MobDetailView({
  mob,
  on_navigate_to_item,
  on_navigate_to_mob,
  on_navigate_to_world,
  children,
  show_stats = true,
}: {
  mob: {
    name: string
    /** Canonical English seed name for icon lookup when `name` has been localized for display. */
    icon_name?: string
    element: string
    minLevel: number
    maxLevel: number
    health: number
    // `null` means "not tracked on this data source" (e.g. the live on-chain MobTemplate has no
    // XP field — see chain/read_templates.js) — the reward box is hidden rather
    // than showing a false "0" for a value that's simply unknown, not zero.
    xpReward: number | null
    isBoss: boolean
    tier?: string | null
    createdAt?: number | string
    zone?: string
    stats: Record<string, number>
    resistances?: Record<string, number> | null
    drops?:
      | {
          id: string
          name: string
          rarity: string
          category: string
          minQty: number
          maxQty: number
          // The EXACT on-chain drop chance as a percent (basis-points / 100, e.g. 2.5 for 250 bp) —
          // rendered verbatim to 2 decimals ("2.50%"), NEVER rounded away — if it's in the
          // encyclopedia THEN players are 100% sure it's in game, with the exact chance. `drop_weight`
          // is only the bar-fill width; `chance_percent` is the source of truth for the number shown.
          // Both optional — a caller may carry exact chance, a legacy bar weight, or neither.
          chance_percent?: number
          drop_weight?: number
        }[]
      | null
    archi_mob?: { id: string; name: string; element: string; minLevel: number; maxLevel: number } | null
    is_archi_of?: { id: string; name: string; element: string; minLevel: number; maxLevel: number }[] | null
    found_in?: { id: string; name: string; biome?: string }[] | null
  }
  on_navigate_to_item?: (id: string) => void
  on_navigate_to_mob?: (id: string) => void
  on_navigate_to_world?: (id: string) => void
  children?: ReactNode
  show_stats?: boolean
}) {
  const { t } = useTranslation()
  const el_color = ELEMENT_COLORS[mob.element.toLowerCase()] || '#6b7280'

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
      {/* Boss banner */}
      {mob.isBoss && (
        <div
          className="px-3 py-2 text-[9px] tracking-[0.25em] uppercase text-center"
          style={{ color: '#c8963c', border: '1px solid rgba(200,150,60,0.3)', background: 'rgba(200,150,60,0.06)' }}
        >
          {t('entity.dungeon_boss')}
        </div>
      )}
      {/* Header */}
      <div className="flex items-start gap-4">
        <EncyclopediaMobImage
          key={mob.icon_name ?? mob.name}
          mob={{ name: mob.icon_name ?? mob.name }}
          hd
          className="w-18 h-18 shrink-0 object-contain"
          style={{ filter: 'drop-shadow(0 0 8px rgba(200,150,60,0.3))' }}
        />
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span
              className={`text-[13px] tracking-[0.15em] uppercase font-semibold ${mob.isBoss ? 'text-gradient' : ''}`}
              style={mob.isBoss ? undefined : { color: '#c8963c' }}
            >
              {mob.name}
            </span>
            {mob.element && (
              <span
                className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5"
                style={{ color: el_color, border: `1px solid ${el_color}40`, background: `${el_color}10` }}
              >
                {mob.element}
              </span>
            )}
            {is_archi_tier(mob.tier) && <ArchiBadge />}
            {is_new_template(mob.createdAt) && <NewBadge />}
            <span className="text-[10px] tracking-wide ml-auto" style={{ color: '#6b7280' }}>
              Lv. {mob.minLevel}&ndash;{mob.maxLevel}
            </span>
          </div>
          {mob.zone && (
            <div className="flex items-center gap-1 text-[9px]" style={{ color: '#6b7280' }}>
              <MapPin size={10} style={{ opacity: 0.4 }} />
              <span className="tracking-[0.15em] uppercase">{mob.zone}</span>
            </div>
          )}
        </div>
      </div>
      {/* Reward boxes — HP reads as LIFE (a heart in the red life tone), distinct from the gold XP reward
          (the life value reads as a heart in a warmer color, not a flat number). #f87171 is the same
          red-family token the negative-resistance number already uses here — no new palette. */}
      <div className="flex gap-2">
        {[
          {
            kind: 'hp',
            label: t('entity.reward_hp'),
            value: mob.health.toLocaleString(),
            icon: Heart,
            color: '#f87171',
          },
          ...(mob.xpReward != null
            ? [
                {
                  kind: 'xp',
                  label: t('entity.reward_xp'),
                  value: mob.xpReward.toString(),
                  icon: Sparkles,
                  color: '#c8963c',
                },
              ]
            : []),
        ].map(({ kind, label, value, icon: Icon, color }) => (
          <div
            key={label}
            data-reward={kind}
            className="flex flex-col items-center gap-1 px-3 py-2 border border-border min-w-[60px]"
          >
            <div className="flex items-center gap-1">
              <Icon size={12} className="opacity-70" style={{ color }} />
              <span className="text-[12px] font-semibold" style={{ color }}>
                {value}
              </span>
            </div>
            <span className="text-[8px] tracking-[0.15em] uppercase" style={{ color: '#6b7280' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <SectionDivider />
      {show_stats && (
        <>
          {/* Combat Stats */}
          <div className="flex flex-col gap-2">
            <SectionTitle title={t('entity.combat_stats')} />
            <div className="grid grid-cols-3 gap-2">
              {['strength', 'intelligence', 'chance', 'agility', 'rawDamage', 'criticalHit'].map((stat_key) => {
                const val = mob.stats[stat_key] ?? 0
                const color = STAT_COLORS[stat_color_key(stat_key)] || '#e8e4dc'
                return (
                  <div
                    key={stat_key}
                    className="stat-card flex flex-col items-center gap-0.5 px-3 py-2 border border-border"
                  >
                    <span className="text-[12px] font-semibold" style={{ color }}>
                      {val}
                    </span>
                    <span className="text-[8px] tracking-[0.15em] uppercase" style={{ color: '#6b7280' }}>
                      {t(STAT_LABEL_KEYS[stat_key] ?? '', { defaultValue: format_stat_name(stat_key) })}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <SectionDivider />
        </>
      )}
      {/* Resistances */}
      {mob.resistances != null && (
        <>
          <div className="flex flex-col gap-2">
            <SectionTitle title={t('entity.resistances')} />
            <div className="grid grid-cols-4 gap-2">
              {(['earth', 'fire', 'water', 'air'] as const).map((element) => {
                const val = mob.resistances![element] ?? 0
                const e_color = ELEMENT_COLORS[element] || '#6b7280'
                const display_color = val < 0 ? '#f87171' : e_color
                return (
                  <div
                    key={element}
                    className="stat-card flex flex-col items-center gap-0.5 px-3 py-2 border border-border"
                  >
                    <span className="text-[12px] font-semibold" style={{ color: display_color }}>
                      {val > 0 ? '+' : ''}
                      {val}%
                    </span>
                    <span className="text-[8px] tracking-[0.15em] uppercase" style={{ color: e_color }}>
                      {element}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <SectionDivider />
        </>
      )}
      {/* Loot Table */}
      <div className="flex flex-col gap-2">
        <SectionTitle title={t('entity.loot_table')} />
        {mob.drops && mob.drops.length > 0 ? (
          <div className="flex flex-col gap-1">
            {mob.drops.map((drop) => {
              const qty = drop.minQty === drop.maxQty ? `×${drop.minQty}` : `×${drop.minQty}-${drop.maxQty}`
              // EXACT on-chain chance (bp/100), rendered to 2 decimals and NEVER rounded.
              const chance = drop.chance_percent ?? drop.drop_weight ?? 0
              return (
                <div
                  key={drop.id}
                  className={`flex flex-col px-2 py-1.5${on_navigate_to_item ? ' cursor-pointer' : ''}`}
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                  onClick={on_navigate_to_item ? () => on_navigate_to_item(drop.id) : undefined}
                  onMouseEnter={
                    on_navigate_to_item
                      ? (e) => {
                          ;(e.currentTarget as HTMLElement).style.background = 'rgba(200,150,60,0.08)'
                        }
                      : undefined
                  }
                  onMouseLeave={
                    on_navigate_to_item
                      ? (e) => {
                          ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text">{drop.name}</span>
                      <span className="text-[8px] tracking-wide uppercase" style={{ color: '#6b728080' }}>
                        {drop.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-semibold tabular-nums" style={{ color: '#c8963c' }}>
                        {chance.toFixed(2)}%
                      </span>
                      <span className="text-[9px]" style={{ color: '#6b7280' }}>
                        {qty}
                      </span>
                    </div>
                  </div>
                  <div className="w-full mt-1" style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
                    <div
                      style={{
                        width: `${Math.min(100, chance)}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, rgba(200,150,60,0.6), rgba(200,150,60,0.3))',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <span className="text-[9px]" style={{ color: '#6b7280', fontStyle: 'italic' }}>
            {t('entity.no_drops')}
          </span>
        )}
      </div>
      <FoundInWorldsSection worlds={mob.found_in} on_navigate_to_world={on_navigate_to_world} />
      {/* Archi Mob - forward: this mob has an archi variant */}
      {mob.archi_mob && (
        <>
          <SectionDivider />
          <div className="flex flex-col gap-2">
            <SectionTitle title={t('entity.has_archi')} />
            <div
              className={`flex items-center gap-2 px-2 py-1.5${on_navigate_to_mob ? ' cursor-pointer' : ''}`}
              style={{ background: 'rgba(255,255,255,0.02)' }}
              onClick={on_navigate_to_mob ? () => on_navigate_to_mob(mob.archi_mob!.id) : undefined}
              onMouseEnter={
                on_navigate_to_mob
                  ? (e) => {
                      ;(e.currentTarget as HTMLElement).style.background = 'rgba(200,150,60,0.08)'
                    }
                  : undefined
              }
              onMouseLeave={
                on_navigate_to_mob
                  ? (e) => {
                      ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'
                    }
                  : undefined
              }
            >
              <div
                className="w-2 h-2 shrink-0"
                style={{ background: ELEMENT_COLORS[mob.archi_mob.element?.toLowerCase()] || '#6b7280' }}
              />
              <span className="text-[10px] tracking-[0.1em] uppercase flex-1" style={{ color: '#c8963c' }}>
                {mob.archi_mob.name}
              </span>
              <span className="text-[9px] tracking-wide shrink-0" style={{ color: '#6b7280' }}>
                Lv. {mob.archi_mob.minLevel}-{mob.archi_mob.maxLevel}
              </span>
            </div>
          </div>
        </>
      )}
      {/* Archi Mob - reverse: this mob IS the archi of others */}
      {mob.is_archi_of && mob.is_archi_of.length > 0 && (
        <>
          <SectionDivider />
          <div className="flex flex-col gap-2">
            <SectionTitle title={t('entity.is_archi_of')} />
            <div className="flex flex-col gap-1">
              {mob.is_archi_of.map((base_mob) => (
                <div
                  key={base_mob.id}
                  className={`flex items-center gap-2 px-2 py-1.5${on_navigate_to_mob ? ' cursor-pointer' : ''}`}
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                  onClick={on_navigate_to_mob ? () => on_navigate_to_mob(base_mob.id) : undefined}
                  onMouseEnter={
                    on_navigate_to_mob
                      ? (e) => {
                          ;(e.currentTarget as HTMLElement).style.background = 'rgba(200,150,60,0.08)'
                        }
                      : undefined
                  }
                  onMouseLeave={
                    on_navigate_to_mob
                      ? (e) => {
                          ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'
                        }
                      : undefined
                  }
                >
                  <div
                    className="w-2 h-2 shrink-0"
                    style={{ background: ELEMENT_COLORS[base_mob.element?.toLowerCase()] || '#6b7280' }}
                  />
                  <span className="text-[10px] tracking-[0.1em] uppercase flex-1" style={{ color: '#e8e4dc' }}>
                    {base_mob.name}
                  </span>
                  <span className="text-[9px] tracking-wide shrink-0" style={{ color: '#6b7280' }}>
                    Lv. {base_mob.minLevel}-{base_mob.maxLevel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {children}
    </div>
  )
}
