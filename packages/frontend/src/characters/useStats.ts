// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import {
  characteristic_allocation_quote,
  characteristic_names,
  experience_progress,
  is_class_name,
  type CharacteristicName,
  type CharacteristicValues,
} from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { localized_error } from '../i18n/error_text.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { character_max_hp, projected_hp } from '../game/character_stats.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { editable_character } from './character_activity.ts'

const empty_allocation = (): Record<CharacteristicName, number> =>
  Object.fromEntries(characteristic_names.map((stat) => [stat, 0])) as Record<CharacteristicName, number>

export function useStats({
  character,
  copy,
  raise_stats,
}: Readonly<{
  character: Readonly<CharacterRow>
  copy: AppCopy
  raise_stats?: (spending: CharacteristicValues) => void
}>) {
  const numbers = useNumbers()
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const available = useAppStore((state) =>
    raise_stats ? character : editable_character(state, character.id, Date.now())
  )
  const [alloc, set_alloc] = useState(empty_allocation)
  const [pending_tx, set_pending_tx] = useState(false)
  const locked = [!available, pending_tx].some(Boolean)

  const classe = is_class_name(character.classe) ? character.classe : null
  const current = Object.fromEntries(
    characteristic_names.map((stat) => [stat, character[stat]])
  ) as CharacteristicValues
  const quote = classe ? characteristic_allocation_quote(classe, current, alloc) : null
  const staged_clicks = characteristic_names.reduce((total, stat) => total + alloc[stat], 0)
  const remaining = Math.max(0, character.available_points - (quote?.cost ?? 0))
  const has_pending = staged_clicks > 0
  const can_confirm =
    [wallet, raise_stats].some(Boolean) && has_pending && !!quote && quote.cost <= character.available_points && !locked

  const experience = Number(character.experience)
  const { level, into, span, percent } = experience_progress(experience)

  const max_health = character_max_hp(character)
  const health = projected_hp(character, Date.now())

  const confirm = (): void => {
    if (!can_confirm) return
    const spending = { ...quote!.costs }
    if (raise_stats) {
      raise_stats(spending)
      set_alloc(empty_allocation())
      return
    }
    if (!wallet) return
    const transaction = run_direct_transaction(() => {
      const current_character = editable_character(read_app_state(), character.id, Date.now())
      if (!current_character) throw localized_error(t('progression_busy'))
      return wallet.character.raise_stats({
        character_id: character.id,
        spending,
        custody: { kiosk: current_character.kiosk, kiosk_cap: current_character.kiosk_cap },
      })
    })
    if (!transaction) return
    set_pending_tx(true)
    const pending = toast.loading(t('stats.tx_pending'))
    void transaction
      .then(() => {
        dispatch_app({ type: 'character/stats_raised', character_id: character.id, spending })
        set_alloc(empty_allocation())
        pending.success(t('stats.tx_success'))
      })
      .catch(pending.error)
      .finally(() => set_pending_tx(false))
  }

  return {
    numbers,
    t,
    wallet,
    available,
    alloc,
    set_alloc,
    reset: () => set_alloc(empty_allocation()),
    pending_tx,
    locked,
    classe,
    current,
    quote,
    staged_clicks,
    remaining,
    has_pending,
    can_confirm,
    level,
    into,
    span,
    percent,
    max_health,
    health,
    confirm,
  }
}
