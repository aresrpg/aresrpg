// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'
import { useMemo, useState } from 'react'

import { encyclopedia_catalog, type SeedSpell } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, spell_name, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { localized_error } from '../i18n/error_text.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import type { CharacterSession } from './character_session.ts'
import { editable_character } from './character_activity.ts'

const spell_level_for = (character: Readonly<CharacterRow>, spell: Readonly<SeedSpell>): number =>
  character.level < spell.unlock_level ? 0 : (character.spells[spell.name] ?? 1)

const upgrade_view = (
  character: Readonly<CharacterRow>,
  selected: Readonly<SeedSpell> | undefined,
  authorized: boolean,
  locked: boolean,
  t: CopyText
) => {
  const current = selected ? spell_level_for(character, selected) : 0
  const max_level = selected?.levels.length ?? 0
  const mastered = current >= max_level && current > 0
  const can_raise = [authorized, current >= 1, !mastered, character.available_spell_points >= current, !locked].every(
    Boolean
  )
  const raise_hint = [!selected, locked, can_raise, mastered].some(Boolean)
    ? undefined
    : current < 1
      ? t('spells.requires_lv', { level: selected!.unlock_level })
      : t('spells.no_points')
  return { current, max_level, mastered, cost: current, can_raise, raise_hint }
}

export function useSpells({
  character,
  copy,
  session,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; session?: CharacterSession }>) {
  const t = copy_text(copy.characters_page)
  const encyclopedia = encyclopedia_text(copy)
  const display_name = (identity: string): string => spell_name(copy, identity)
  const live_wallet = useAppStore(({ session }) => session.wallet)
  const live_character = useAppStore((state) => editable_character(state, character.id, Date.now()))
  const wallet = session ? null : live_wallet
  const available = session ? character : live_character
  const [selected_name, set_selected_name] = useState<string | null>(null)
  const [raising, set_raising] = useState(false)
  const locked = [!available, raising].some(Boolean)
  const spells = useMemo(
    () =>
      (encyclopedia_catalog.class(character.classe)?.spells ?? []).toSorted(
        (left, right) => left.unlock_level - right.unlock_level || left.name.localeCompare(right.name)
      ),
    [character.classe]
  )
  const level_of = (spell: Readonly<SeedSpell>): number => spell_level_for(character, spell)
  const unlocked_count = spells.filter((spell) => level_of(spell) >= 1).length
  const selected =
    spells.find(({ name }) => name === selected_name) ?? spells.find((spell) => level_of(spell) >= 1) ?? spells[0]
  const points = character.available_spell_points
  const { current, max_level, mastered, cost, can_raise, raise_hint } = upgrade_view(
    character,
    selected,
    Boolean(session?.raise_spell ?? wallet),
    locked,
    t
  )

  const raise = (): void => {
    if (!can_raise || !selected) return
    if (session) return session.raise_spell?.(selected.name)
    if (!wallet) return
    const transaction = run_direct_transaction(() => {
      const current_character = editable_character(read_app_state(), character.id, Date.now())
      if (!current_character) throw localized_error(t('progression_busy'))
      return wallet.character.raise_spell({
        character_id: character.id,
        spell: selected.name,
        custody: { kiosk: current_character.kiosk, kiosk_cap: current_character.kiosk_cap },
      })
    })
    if (!transaction) return
    set_raising(true)
    const pending = toast.loading(t('spells.upgrading'))
    void transaction
      .then(() => {
        dispatch_app({ type: 'character/spell_raised', character_id: character.id, spell: selected.name })
        pending.success(t('spells.upgrade_success', { spell: display_name(selected.name) }))
      })
      .catch(pending.error)
      .finally(() => set_raising(false))
  }

  return {
    t,
    encyclopedia,
    display_name,
    wallet,
    available,
    selected_name,
    set_selected_name,
    raising,
    locked,
    spells,
    level_of,
    unlocked_count,
    selected,
    points,
    current,
    max_level,
    mastered,
    cost,
    can_raise,
    raise_hint,
    raise,
  }
}
