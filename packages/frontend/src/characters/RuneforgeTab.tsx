// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// RUNEFORGE — the three-panel workbench: LEFT the selected gear's sheet (the shared
// ItemDetailView, rolled stats), CENTER the work surface (place gear + rune, apply), RIGHT
// the bag pool (gear / runes tabs). The outcome is the chain's random roll — no success
// percentage is ever shown (honest-data law); the RuneScribed event is the one truth and one
// certified input folds both the item delta and the session ledger. The gear category's
// forgery job comes from the shared category map and is available from level 1, matching Move.

import { Button } from '@aresrpg/ui'
import { format_rune_weight, rune_effect } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { Gem, Plus, Sparkles, Swords, X } from 'lucide-react'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { copy_text, stat_name, type AppCopy } from '../i18n/copy.ts'
import { inventory_groups } from '../inventory_stacks.ts'
import { type ScribeHistoryEntry, type ScribeOutcomeKind } from '../modules/runeforge.ts'

import { useRuneforge, OUTCOME_COPY_KEY } from './useRuneforge.ts'
import { RUNE_UNLOCK_LEVEL } from './forge_eligibility.ts'
import { InventoryItemCell } from './InventoryItemCell.tsx'

const OUTCOME_CLASS: Readonly<Record<ScribeOutcomeKind, string>> = Object.freeze({
  critical_success: 'text-cyan',
  neutral_success: 'text-gold',
  critical_failure: 'text-[#ff7d94]',
})

const ScribeHistory = ({
  copy,
  current_puits,
  entries,
}: Readonly<{ copy: AppCopy; current_puits: string; entries: readonly ScribeHistoryEntry[] }>) => {
  const t = copy_text(copy.characters_page)
  return (
    <section className="flex min-h-56 flex-col border border-border bg-black/15" data-runeforge-history="">
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-[9px] font-semibold tracking-[0.18em] text-muted uppercase">
          {t('runeforge_history')}
        </span>
        <span className="text-[9px] tracking-[0.12em] text-muted uppercase">
          {t('runeforge_puits')} <b className="text-gold tabular-nums">{format_rune_weight(current_puits)}</b>
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {entries.length === 0 ? (
          <div className="grid min-h-28 place-items-center px-4 text-center text-[9px] tracking-[0.14em] text-muted uppercase">
            {t('runeforge_history_empty')}
          </div>
        ) : (
          entries.map((entry) => {
            const no_stat_change = entry.applied_value === 0 && entry.losses.length === 0
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
                  {entry.losses.map(({ stat, amount }) => (
                    <span className="text-[#ff7d94]" key={stat}>
                      −{amount} {stat_name(copy, stat)}
                    </span>
                  ))}
                  {no_stat_change && <span className="text-muted">{t('runeforge_no_stat_change')}</span>}
                </div>
                <div className="mt-2 border-t border-white/6 pt-2 text-[8px] tracking-[0.12em] text-muted uppercase">
                  {t('runeforge_puits')}{' '}
                  <span className="text-text tabular-nums">{format_rune_weight(entry.puits_before)}</span>
                  <span className="px-1.5 text-muted/60">→</span>
                  <span className="text-gold tabular-nums">{format_rune_weight(entry.puits_after)}</span>
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

const PlacedRuneDetails = ({ item, copy }: Readonly<{ item: Readonly<ItemRow>; copy: AppCopy }>) => {
  const rune = rune_effect(item.item_type)
  if (!rune) return null
  return (
    <div className="text-[9px] text-gold tabular-nums">
      <div data-rune-effect="">
        +{rune.amount} {stat_name(copy, rune.stat)}
      </div>
      <div>×{item.amount}</div>
    </div>
  )
}

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
          <PlacedRuneDetails item={selected} copy={copy} />
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

export default function RuneforgeTab({
  character,
  copy,
  inventory,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; inventory?: readonly ItemRow[] }>) {
  const {
    t,
    vocabulary,
    encyclopedia,
    gear_id,
    set_gear_id,
    rune_id,
    set_rune_id,
    pool_tab,
    set_pool_tab,
    busy,
    gear,
    runes,
    sel_gear,
    sel_rune,
    current_puits,
    history,
    forge_job,
    job_short,
    stat_maxed,
    can_apply,
    apply,
    gear_detail,
  } = useRuneforge({ character, copy, inventory })

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
        <div className="chr-forge__panel chr-forge__inspection">
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
        <div className="chr-forge__panel chr-forge__work">
          <div className="chr-forge__ptitle">{t('forge_title')}</div>
          <div className="chr-forge__workspace grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5">
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
                      ? t('requires_job', { job: vocabulary.job(forge_job), level: RUNE_UNLOCK_LEVEL })
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
                    ? t('requires_job', { job: vocabulary.job(forge_job), level: RUNE_UNLOCK_LEVEL })
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
        <div className="chr-forge__panel chr-forge__inventory">
          <div className="chr-forge__ptitle">{t('inventory_title')}</div>
          <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
            {(['gear', 'runes'] as const).map((key) => (
              <Button
                className="chr-forge-tab"
                aria-pressed={pool_tab === key}
                key={key}
                onClick={() => set_pool_tab(key)}
                type="button"
              >
                {key === 'gear' ? t('tab_gear') : t('tab_runes')}
                <span className="text-[9px] opacity-70 tabular-nums">
                  {key === 'gear' ? gear.length : inventory_groups(runes).length}
                </span>
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {pool.length === 0 ? (
              empty(pool_tab === 'gear' ? t('no_forge_gear') : t('no_runes'))
            ) : (
              <div className="chr-forge__pool">
                {inventory_groups(pool).map(({ item, amount }) => {
                  const selected = (pool_tab === 'gear' ? gear_id : rune_id) === item.id
                  return (
                    <InventoryItemCell
                      amount={amount}
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
