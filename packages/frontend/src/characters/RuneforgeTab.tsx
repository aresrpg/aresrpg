// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RUNEFORGE — the three-panel workbench: LEFT the selected gear's sheet (the shared
// ItemDetailView, rolled stats), CENTER the work surface (place gear + rune, apply), RIGHT
// the bag pool (gear / runes tabs). The outcome is the chain's random roll — no success
// percentage is ever shown (honest-data law); the RuneScribed event is the one truth and one
// certified input folds both the item delta and the session ledger. The gear category's
// forgery job comes from the shared category map and must be level 70, matching Move.

import { useMemo, useState } from 'react'
import { craft_job_of, item_stat_center, rune_effect, rune_max_apps, stat_names } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { Gem, Plus, Sparkles, Swords, X } from 'lucide-react'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, stat_name, type AppCopy } from '../i18n/copy.ts'
import { scribe_outcome_kind, type ScribeHistoryEntry, type ScribeOutcomeKind } from '../modules/runeforge.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { has_runeforge_job_level, is_forge_gear, is_rune, RUNE_UNLOCK_LEVEL } from './forge_eligibility.ts'
import { InventoryItemCell } from './InventoryItemCell.tsx'

const EMPTY_HISTORY = Object.freeze([]) as readonly ScribeHistoryEntry[]
const OUTCOME_COPY_KEY: Readonly<Record<ScribeOutcomeKind, string>> = Object.freeze({
  critical_success: 'outcome_critical_success',
  neutral_success: 'outcome_neutral_success',
  critical_failure: 'outcome_critical_failure',
})
const OUTCOME_CLASS: Readonly<Record<ScribeOutcomeKind, string>> = Object.freeze({
  critical_success: 'text-cyan',
  neutral_success: 'text-gold',
  critical_failure: 'text-[#ff7d94]',
})

const ScribeHistory = ({
  copy,
  current_puits,
  entries,
}: Readonly<{ copy: AppCopy; current_puits: number; entries: readonly ScribeHistoryEntry[] }>) => {
  const t = copy_text(copy.characters_page)
  return (
    <section className="flex min-h-56 flex-col border border-border bg-black/15" data-runeforge-history="">
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[9px] font-semibold tracking-[0.18em] text-muted uppercase">
          {t('runeforge_history')}
        </span>
        <span className="text-[9px] tracking-[0.12em] text-muted uppercase">
          {t('runeforge_puits')} <b className="text-gold tabular-nums">{current_puits}</b>
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {entries.length === 0 ? (
          <div className="grid min-h-28 place-items-center px-4 text-center text-[9px] tracking-[0.14em] text-muted uppercase">
            {t('runeforge_history_empty')}
          </div>
        ) : (
          entries.map((entry) => {
            const no_stat_change = entry.applied_value === 0 && entry.lost_amount === 0
            const rune_name = encyclopedia_catalog.item(entry.rune_item_type)?.item.name ?? entry.rune_item_type
            return (
              <article className="border border-white/8 bg-white/[0.018] p-3" key={entry.digest}>
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`text-[9px] font-semibold tracking-[0.12em] uppercase ${OUTCOME_CLASS[entry.outcome]}`}
                  >
                    {t(OUTCOME_COPY_KEY[entry.outcome]!)}
                  </span>
                  <span className="truncate text-[8px] text-muted">{rune_name}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tabular-nums">
                  {entry.applied_value > 0 && (
                    <span className="text-cyan">
                      +{entry.applied_value} {stat_name(copy, entry.applied_stat)}
                    </span>
                  )}
                  {entry.lost_stat && entry.lost_amount > 0 && (
                    <span className="text-[#ff7d94]">
                      −{entry.lost_amount} {stat_name(copy, entry.lost_stat)}
                    </span>
                  )}
                  {no_stat_change && <span className="text-muted">{t('runeforge_no_stat_change')}</span>}
                </div>
                <div className="mt-2 border-t border-white/6 pt-2 text-[8px] tracking-[0.12em] text-muted uppercase">
                  {t('runeforge_puits')} <span className="text-text tabular-nums">{entry.puits_before}</span>
                  <span className="px-1.5 text-muted/60">→</span>
                  <span className="text-gold tabular-nums">{entry.puits_after}</span>
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

const PlacedStackAmount = ({ amount, kind }: Readonly<{ amount: number; kind: 'gear' | 'rune' }>) =>
  kind === 'rune' ? <span className="text-[9px] text-gold tabular-nums">×{amount}</span> : null

const selected_runeforge_view = (
  gear: Readonly<ItemRow> | null,
  gear_id: string | null,
  history_by_gear: Readonly<Record<string, readonly ScribeHistoryEntry[]>>
): Readonly<{ current_puits: number; history: readonly ScribeHistoryEntry[] }> =>
  Object.freeze({
    current_puits: Number(gear?.puits ?? 0),
    history: history_by_gear[gear_id ?? ''] ?? EMPTY_HISTORY,
  })

const WorkSlot = ({
  clear,
  copy,
  items,
  kind,
  place,
  selected,
}: Readonly<{
  clear: () => void
  copy: AppCopy
  items: readonly Readonly<ItemRow>[]
  kind: 'gear' | 'rune'
  place: (id: string) => void
  selected: Readonly<ItemRow> | null
}>) => {
  const t = copy_text(copy.characters_page)
  const Glyph = kind === 'gear' ? Swords : Gem
  return (
    <div
      className={`chr-forge__slot ${selected ? 'is-filled' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const id = event.dataTransfer.getData('text/plain')
        if (items.some((item) => item.id === id)) place(id)
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
          <PlacedStackAmount amount={selected.amount} kind={kind} />
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
  const history_by_gear = useAppStore(({ runeforge }) => runeforge.history_by_gear)
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
  const { current_puits, history } = selected_runeforge_view(sel_gear, gear_id, history_by_gear)

  const forge_job = sel_gear ? craft_job_of(sel_gear.category) : null
  const job_short = !!sel_gear && !has_runeforge_job_level(sel_gear.category, character.jobs, RUNE_UNLOCK_LEVEL)
  const stat_maxed = rune_stat_maxed(sel_gear, sel_rune)
  const can_apply = !!wallet && !!sel_gear && !!sel_rune && !job_short && !stat_maxed && !busy

  const apply = (): void => {
    if (!can_apply || !wallet || !sel_gear || !sel_rune) return
    const transaction = run_direct_transaction(() =>
      wallet.character.scribe_rune({
        character_id: character.id,
        gear_id: sel_gear.id,
        gear_item_type: sel_gear.item_type,
        rune_item_id: sel_rune.id,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
    )
    if (!transaction) return
    set_busy(true)
    const pending = toast.loading(t('scribing'))
    void transaction
      .then((outcome) => {
        dispatch_app({
          type: 'runeforge/scribed',
          gear_before: sel_gear,
          rune_before: sel_rune,
          outcome,
        })
        const key = scribe_outcome_kind(outcome.outcome)
        const message = t(OUTCOME_COPY_KEY[key])
        if (key === 'critical_failure') pending.error(new Error(message))
        else pending.success(message)
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

  const pool = pool_tab === 'gear' ? gear : runes

  return (
    <div className="chr-forge" data-tutorial-target="character_runeforge">
      <div className="chr-forge__head">
        <span className="text-[11px] font-semibold tracking-[0.28em] text-gold uppercase">{t('tab_runeforge')}</span>
        <span className="text-[9px] tracking-[0.14em] text-muted uppercase">
          {t('gate_note', { level: RUNE_UNLOCK_LEVEL })}
        </span>
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
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 2xl:grid-cols-[minmax(300px,420px)_minmax(260px,1fr)] 2xl:overflow-hidden">
            <div className="flex min-h-0 flex-col items-center justify-center gap-6 overflow-y-auto">
              <div className="flex items-center justify-center gap-3 pt-2">
                <WorkSlot
                  clear={() => set_gear_id(null)}
                  copy={copy}
                  items={gear}
                  kind="gear"
                  place={set_gear_id}
                  selected={sel_gear}
                />
                <Plus className="shrink-0 text-gold/50" size={16} />
                <WorkSlot
                  clear={() => set_rune_id(null)}
                  copy={copy}
                  items={runes}
                  kind="rune"
                  place={set_rune_id}
                  selected={sel_rune}
                />
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
                      ? t('requires_job', { job: titleize(forge_job), level: RUNE_UNLOCK_LEVEL })
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
                    ? t('requires_job', { job: titleize(forge_job), level: RUNE_UNLOCK_LEVEL })
                    : stat_maxed
                      ? t('stat_maxed')
                      : t('one_rune_note')}
                </div>
              </div>
            </div>
            <ScribeHistory copy={copy} current_puits={current_puits} entries={history} />
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
                    <InventoryItemCell
                      class_name={selected ? 'is-selected' : ''}
                      draggable
                      item={item}
                      key={item.id}
                      onClick={() => (pool_tab === 'gear' ? set_gear_id(item.id) : set_rune_id(item.id))}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                    />
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
