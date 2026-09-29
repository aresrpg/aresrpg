// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { craft_job_of, item_stat_center, rune_can_apply, rune_effect, stat_names } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { useMemo, useState } from 'react'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { localized_error } from '../i18n/error_text.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { available_inventory_items, encumbered_asset_ids, stack_merge_sources } from '../inventory_stacks.ts'
import { scribe_outcome_kind, type ScribeHistoryEntry, type ScribeOutcomeKind } from '../modules/runeforge.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { has_runeforge_job_level, is_forge_gear, is_rune, RUNE_UNLOCK_LEVEL } from './forge_eligibility.ts'

const EMPTY_HISTORY = Object.freeze([]) as readonly ScribeHistoryEntry[]
export const OUTCOME_COPY_KEY: Readonly<Record<ScribeOutcomeKind, string>> = Object.freeze({
  critical_success: 'outcome_critical_success',
  neutral_success: 'outcome_neutral_success',
  critical_failure: 'outcome_critical_failure',
})
const selected_runeforge_view = (
  gear: Readonly<ItemRow> | null,
  gear_id: string | null,
  history_by_gear: Readonly<Record<string, readonly ScribeHistoryEntry[]>>
): Readonly<{ current_puits: string; history: readonly ScribeHistoryEntry[] }> =>
  Object.freeze({
    current_puits: gear?.puits ?? '0',
    history: history_by_gear[gear_id ?? ''] ?? EMPTY_HISTORY,
  })

/** Predict the same current-stat limits as Move from the canonical authored template. */
const rune_stat_maxed = (gear: Readonly<ItemRow> | null, rune: Readonly<ItemRow> | null): boolean => {
  if (!gear?.stats || !rune) return false
  const effect = rune_effect(rune.item_type)
  const maximum = encyclopedia_catalog.item(gear.item_type)?.item.stats?.max
  if (!effect || !maximum) return false
  const { stats } = gear
  const current = Object.fromEntries(stat_names.map((stat) => [stat, stats[stat] - item_stat_center]))
  return !rune_can_apply(current, maximum, effect)
}

export function useRuneforge({
  character,
  copy,
  inventory: supplied_inventory,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; inventory?: readonly ItemRow[] }>) {
  const t = copy_text(copy.characters_page)
  const vocabulary = useVocabulary()
  const encyclopedia = encyclopedia_text(copy)
  const wallet = useAppStore(({ session }) => (supplied_inventory ? null : session.wallet))
  const all_inventory = useAppStore(({ session }) => supplied_inventory ?? session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const history_by_gear = useAppStore(({ runeforge }) => runeforge.history_by_gear)
  const encumbered = useMemo(() => encumbered_asset_ids(listings, trades), [listings, trades])
  const inventory = useMemo(
    () => available_inventory_items(all_inventory, encumbered, character.kiosk),
    [all_inventory, character.kiosk, encumbered]
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
        merge_sources: stack_merge_sources(all_inventory, encumbered, sel_rune),
        character_id: character.id,
        gear_id: sel_gear.id,
        gear_item_type: sel_gear.item_type,
        rune_item_id: sel_rune.id,
        rune_item_type: sel_rune.item_type,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
    )
    if (!transaction) return
    set_busy(true)
    const pending = toast.loading(t('scribing'))
    void transaction
      .then((outcome) => {
        dispatch_app({ type: 'inventory/amounts_changed', changes: outcome.inventory_changes ?? [] })
        dispatch_app({
          type: 'runeforge/scribed',
          gear_before: sel_gear,
          rune_before: sel_rune,
          outcome,
        })
        const key = scribe_outcome_kind(outcome.outcome)
        const message = t(OUTCOME_COPY_KEY[key])
        if (key === 'critical_failure') pending.error(localized_error(message))
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

  return {
    t,
    vocabulary,
    encyclopedia,
    wallet,
    all_inventory,
    listings,
    trades,
    history_by_gear,
    encumbered,
    inventory,
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
  }
}
