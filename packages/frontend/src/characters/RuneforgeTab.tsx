// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RUNEFORGE — the three-panel workbench: LEFT the selected gear's sheet (the shared
// ItemDetailView, rolled stats), CENTER the work surface (place gear + rune, apply), RIGHT
// the bag pool (gear / runes tabs). The outcome is the chain's random roll — no success
// percentage is ever shown (honest-data law); the RuneScribed event is the one truth and
// folds through the session reducer. The gear category's forgery-job gate is projected from
// forgemagie.move so this prediction cannot drift from the chain.

import { useMemo, useState } from 'react'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import {
  craft_job_of,
  item_stat_center,
  job_level_from_xp,
  rune_effect,
  rune_max_apps,
  stat_names,
} from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { Gem, Plus, Sparkles, Swords, X } from 'lucide-react'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon } from '../content/assets.ts'
import { titleize } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import { is_forge_gear, is_rune } from './forge_eligibility.ts'

const rune_unlock_level = Number(CONTRACT_CONSTANTS.rune_unlock_level)

/** rune_catalog MAX_APPS predicted off the projected ForgeKey counters — a capped stat
 *  never fires a doomed transaction. */
const rune_stat_maxed = (gear: Readonly<ItemRow> | null, rune: Readonly<ItemRow> | null): boolean => {
  const stat = rune ? rune_effect(rune.item_type)?.stat : undefined
  if (!stat || !gear) return false
  const cap = rune_max_apps(stat)
  return cap > 0 && (gear.apps?.[stat_names.indexOf(stat)] ?? 0) >= cap
}

export default function RuneforgeTab({
  character,
  copy,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) {
  const t = copy_text(copy.characters_page)
  const encyclopedia = encyclopedia_text(copy)
  const wallet = useAppStore(({ session }) => session.wallet)
  const all_inventory = useAppStore(({ session }) => session.inventory)
  const inventory = useMemo(
    () => all_inventory.filter(({ kiosk }) => kiosk === character.kiosk),
    [all_inventory, character.kiosk]
  )
  const [gear_id, set_gear_id] = useState<string | null>(null)
  const [rune_id, set_rune_id] = useState<string | null>(null)
  const [pool_tab, set_pool_tab] = useState<'gear' | 'runes'>('gear')
  const [busy, set_busy] = useState(false)

  const gear = useMemo(() => inventory.filter(is_forge_gear), [inventory])
  const runes = useMemo(() => inventory.filter(is_rune), [inventory])
  const sel_gear = gear.find(({ id }) => id === gear_id) ?? null
  const sel_rune = runes.find(({ id }) => id === rune_id) ?? null

  const forge_job = sel_gear ? craft_job_of(sel_gear.category) : null
  const forge_job_level = forge_job ? job_level_from_xp(Number(character.jobs[forge_job] ?? 0)) : 0
  const job_short = !!sel_gear && !!forge_job && forge_job_level < rune_unlock_level
  const stat_maxed = rune_stat_maxed(sel_gear, sel_rune)
  const can_apply = !!wallet && !!sel_gear && !!sel_rune && !job_short && !stat_maxed && !busy

  const apply = (): void => {
    if (!can_apply || !wallet || !sel_gear || !sel_rune) return
    set_busy(true)
    const pending = toast.loading(t('scribing'))
    void wallet.character
      .scribe_rune({
        character_id: character.id,
        gear_id: sel_gear.id,
        gear_item_type: sel_gear.item_type,
        rune_item_id: sel_rune.id,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
      .then((outcome) => {
        // the rune spend folds now; the gear's CAPPED new block arrives via packet/item_updated
        dispatch_app({ type: 'character/rune_scribed', gear_id: sel_gear.id, rune_item_id: sel_rune.id })
        set_rune_id(null)
        if (outcome.applied_value > 0) pending.success(t('outcome_success'))
        else if (outcome.lost_amount > 0) pending.error(new Error(t('outcome_failure')))
        else pending.success(t('outcome_neutral'))
      })
      .catch(pending.error)
      .finally(() => set_busy(false))
  }

  const gear_detail = useMemo(() => {
    if (!sel_gear) return null
    const rolled = sel_gear.stats
      ? Object.fromEntries(
          Object.entries(sel_gear.stats)
            .map(([stat, value]) => [stat, value - item_stat_center])
            .filter(([, value]) => value !== 0)
        )
      : null
    return {
      name: sel_gear.name,
      category: sel_gear.category,
      level: sel_gear.level,
      item_type: sel_gear.item_type,
      stats: rolled ? { min: rolled, max: rolled } : undefined,
      damages: (sel_gear.damages ?? []).map((line) => ({
        element: line.element,
        from: Number(line.from),
        to: Number(line.to),
        damage_type: 'damage',
      })),
    }
  }, [sel_gear])

  const empty = (label: string) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-muted">
      <Sparkles className="opacity-25" size={18} />
      <span className="text-[10px] tracking-[0.16em] uppercase">{label}</span>
    </div>
  )

  const work_slot = (
    kind: 'gear' | 'rune',
    selected: Readonly<ItemRow> | null,
    clear: () => void,
    place: (id: string) => void
  ) => {
    const Glyph = kind === 'gear' ? Swords : Gem
    const pool = kind === 'gear' ? gear : runes
    return (
      <div
        className={`chr-forge__slot ${selected ? 'is-filled' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const id = event.dataTransfer.getData('text/plain')
          if (pool.some((item) => item.id === id)) place(id)
        }}
      >
        {selected ? (
          <>
            <button aria-label={t('clear')} className="chr-forge__clear" onClick={clear} type="button">
              <X size={13} />
            </button>
            {item_detail_icon(selected.item_type) ? (
              <img alt="" className="size-14 object-contain" src={item_detail_icon(selected.item_type)!} />
            ) : (
              <Glyph className="opacity-40" size={20} />
            )}
            <span className="line-clamp-2 text-[9px] leading-tight tracking-[0.05em] text-text uppercase">
              {selected.name}
            </span>
          </>
        ) : (
          <>
            <Glyph className="opacity-25" size={20} />
            <span className="text-[9px] tracking-[0.14em] text-muted uppercase">
              {kind === 'gear' ? t('place_gear') : t('place_rune')}
            </span>
          </>
        )}
      </div>
    )
  }

  const pool = pool_tab === 'gear' ? gear : runes

  return (
    <div className="chr-forge">
      <div className="chr-forge__head">
        <span className="text-[11px] font-semibold tracking-[0.28em] text-gold uppercase">{t('tab_runeforge')}</span>
        <span className="text-[9px] tracking-[0.14em] text-muted uppercase">{t('gate_note')}</span>
      </div>
      <div className="chr-forge__panels">
        {/* LEFT — the gear sheet */}
        <div className="chr-forge__panel">
          <div className="chr-forge__ptitle">{t('detail_title')}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {gear_detail ? (
              <ItemDetailView
                category={gear_detail.category}
                damages={gear_detail.damages}
                item_type={gear_detail.item_type}
                labels={{
                  characteristics: encyclopedia('characteristics'),
                  damages: encyclopedia('damages'),
                  level_short: encyclopedia('level_short', { level: gear_detail.level }),
                  range_to: encyclopedia('range_to'),
                }}
                level={gear_detail.level}
                name={gear_detail.name}
                stats={gear_detail.stats}
              />
            ) : (
              empty(t('inspect_empty'))
            )}
          </div>
        </div>

        {/* CENTER — the work surface */}
        <div className="chr-forge__panel">
          <div className="chr-forge__ptitle">{t('forge_title')}</div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-5">
            <div className="flex items-center justify-center gap-3 pt-2">
              {work_slot('gear', sel_gear, () => set_gear_id(null), set_gear_id)}
              <Plus className="shrink-0 text-gold/50" size={16} />
              {work_slot('rune', sel_rune, () => set_rune_id(null), set_rune_id)}
            </div>
            <div className="max-w-[340px] text-center text-[9.5px] leading-relaxed tracking-[0.03em] text-muted">
              {t('random_notice')}
            </div>
            <div className="w-full max-w-[340px]">
              <button
                className="btn-gold flex w-full items-center justify-center gap-2 py-3 tracking-[0.22em] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!can_apply}
                onClick={apply}
                title={
                  job_short && forge_job
                    ? t('requires_job', { job: titleize(forge_job) })
                    : stat_maxed
                      ? t('stat_maxed')
                      : undefined
                }
                type="button"
              >
                {busy ? t('scribing') : t('apply')}
              </button>
              <div className="mt-2 text-center text-[9px] tracking-[0.1em] text-muted uppercase">
                {job_short && forge_job
                  ? t('requires_job', { job: titleize(forge_job) })
                  : stat_maxed
                    ? t('stat_maxed')
                    : t('one_rune_note')}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — the pool */}
        <div className="chr-forge__panel">
          <div className="chr-forge__ptitle">{t('inventory_title')}</div>
          <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
            {(['gear', 'runes'] as const).map((key) => (
              <button
                className={`flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[9px] tracking-[0.12em] uppercase transition-colors ${
                  pool_tab === key ? 'text-gold' : 'text-muted hover:text-text'
                }`}
                key={key}
                onClick={() => set_pool_tab(key)}
                type="button"
              >
                {key === 'gear' ? t('tab_gear') : t('tab_runes')}
                <span className="text-[9px] opacity-70 tabular-nums">
                  {key === 'gear' ? gear.length : runes.length}
                </span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {pool.length === 0 ? (
              empty(pool_tab === 'gear' ? t('no_forge_gear') : t('no_runes'))
            ) : (
              <div className="chr-forge__pool">
                {pool.map((item) => {
                  const selected = (pool_tab === 'gear' ? gear_id : rune_id) === item.id
                  return (
                    <button
                      className={`chr-cell ${selected ? 'is-selected' : ''}`}
                      draggable
                      key={item.id}
                      onClick={() => (pool_tab === 'gear' ? set_gear_id(item.id) : set_rune_id(item.id))}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                      title={item.name}
                      type="button"
                    >
                      {item_icon(item.item_type) ? (
                        <img alt="" className="chr-cell__art" draggable={false} src={item_icon(item.item_type)!} />
                      ) : (
                        <span className="chr-cell__fallback">{item.name.slice(0, 1).toUpperCase()}</span>
                      )}
                      {item.amount > 1 && <span className="chr-cell__amount tabular-nums">×{item.amount}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
