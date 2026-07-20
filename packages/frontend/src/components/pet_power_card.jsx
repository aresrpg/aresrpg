// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'

import { STAT_COLORS, sort_stat_entries, stat_color_key, stat_label } from './entity_colors'

export const PET_MAX_FEEDS = 60

const finite_number = (value) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function pet_feed_count(pet) {
  const value = finite_number(pet?.feed_count)
  if (value == null) return null
  return Math.min(PET_MAX_FEEDS, Math.max(0, Math.trunc(value)))
}

export function pet_next_feed_at_ms(pet) {
  const value = finite_number(pet?.next_feed_at_ms)
  return value == null || value < 0 ? null : Math.trunc(value)
}

export function pet_feed_is_available(pet, now_ms = Date.now()) {
  const count = pet_feed_count(pet)
  const next_at = pet_next_feed_at_ms(pet)
  return count != null && next_at != null && count < PET_MAX_FEEDS && next_at <= now_ms
}

/**
 * CLIENT-COMPUTED stats-at-power (the data exists — show the computed target values, never
 * a syncing shrug"). `pet.effective_stats`/`effective_stats_json` has no producer anywhere on the live
 * read path (grep-verified: only pet_power_card.jsx reads it, nothing sets it) — the "syncing" fallback was
 * permanently stuck, not actually waiting on anything. This mirrors item_stats::scale_field exactly (the
 * SAME floor-scaled magnitude pet.move's advance_pet computes on-chain): `max_stats` is the pet template's
 * authored ceiling (seed/mainnet pet rows: stats.min === stats.max always, verified across the full pet
 * corpus — the seed-authored ceiling IS item_stats::stats_max(template)), `feed_count` is the reliable
 * event-sourced field (never the async-snapshot one). Zero-valued fields are dropped, matching
 * pet_effective_stats's own filter (an honest "no bonus yet" at 0 power, not a fabricated "+0" line).
 */
export function pet_stats_at_power(max_stats, feed_count) {
  if (!max_stats || typeof max_stats !== 'object') return null
  const count = finite_number(feed_count)
  if (count == null) return null
  const clamped = Math.min(PET_MAX_FEEDS, Math.max(0, Math.trunc(count)))
  return Object.fromEntries(
    Object.entries(max_stats)
      .map(([key, ceiling]) => {
        const magnitude = finite_number(ceiling)
        if (magnitude == null) return [key, 0]
        const sign = magnitude < 0 ? -1 : 1
        return [key, sign * Math.floor((Math.abs(magnitude) * clamped) / PET_MAX_FEEDS)]
      })
      .filter(([, value]) => value !== 0)
  )
}

export function pet_effective_stats(pet) {
  const source = pet?.effective_stats ?? pet?.effective_stats_json
  if (!source) return null
  try {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, finite_number(value)])
        .filter(([, value]) => value != null && value !== 0)
    )
  } catch {
    return null
  }
}

export function pet_feed_foods(owned, pet) {
  if (!Array.isArray(owned) || !pet?.kiosk_id || !pet?.kiosk_cap_id) return []
  return owned.filter(
    (item) =>
      item.item_category === 'resource' &&
      item.pet_feed_allowed === true &&
      item.kiosk_id === pet.kiosk_id &&
      item.kiosk_cap_id === pet.kiosk_cap_id &&
      !item.listed &&
      Number(item.amount) > 0
  )
}

export function PetPowerCard({ pet, pet_max_stats, now_ms = Date.now() }) {
  const { t, i18n } = useTranslation()
  const count = pet_feed_count(pet)
  const next_at = pet_next_feed_at_ms(pet)
  // The indexer-projected block wins when present; otherwise derive it client-side from the pet template's
  // seed-authored ceiling (never the permanent "syncing" shrug — see pet_stats_at_power's docstring).
  const stats = pet_effective_stats(pet) ?? pet_stats_at_power(pet_max_stats, pet?.feed_count)
  const progress = count == null ? 0 : (count * 100) / PET_MAX_FEEDS
  const next_label =
    count == null
      ? t('pet.power_projection_pending')
      : count >= PET_MAX_FEEDS
        ? t('pet.max_power')
        : next_at == null
          ? t('pet.power_projection_pending')
          : next_at <= now_ms
            ? t('pet.feed_available_now')
            : t('pet.feed_available_at', {
                date: new Date(next_at).toLocaleString(i18n.resolvedLanguage ?? i18n.language),
              })

  return (
    <section className="flex flex-col gap-2 border border-white/10 bg-black/20 p-3" aria-label={t('pet.power')}>
      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em]">
        <span className="text-gold">{t('pet.power')}</span>
        <span className="hud-num text-fg">
          {count == null ? '—' : count} / {PET_MAX_FEEDS}
        </span>
      </div>
      <div className="h-1 overflow-hidden bg-white/10" aria-hidden="true">
        <div className="h-full bg-gold" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-[9px] tracking-wide text-muted">{next_label}</span>
      <div className="mt-1 flex flex-col gap-1">
        <span className="text-[9px] uppercase tracking-[0.12em] text-muted">{t('pet.current_stats')}</span>
        {stats === null ? (
          <span className="text-[9px] text-muted">{t('pet.current_stats_unavailable')}</span>
        ) : Object.keys(stats).length > 0 ? (
          sort_stat_entries(Object.entries(stats)).map(([key, value]) => {
            const color = STAT_COLORS[stat_color_key(key)] || '#e8e4dc'
            return (
              <div key={key} className="flex justify-between gap-3 text-[10px] tracking-wide">
                <span style={{ color }}>{stat_label(t, key)}</span>
                <span className="hud-num" style={{ color }}>
                  +{value}
                </span>
              </div>
            )
          })
        ) : (
          <span className="text-[9px] text-muted">{t('pet.no_current_stats')}</span>
        )}
      </div>
    </section>
  )
}

export function PetFullFedNote() {
  const { t } = useTranslation()
  return (
    <div className="border border-gold/20 bg-gold/5 px-2 py-1.5 text-[9px] leading-relaxed text-muted">
      {t('pet.full_fed_note', { count: PET_MAX_FEEDS })}
    </div>
  )
}
