// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Encyclopedia bridge from the selected Character to the same learned-level truth the live grimoire reads.

import { useEffect, useMemo, useState } from 'react'

import { read_spell_state } from '../../chain/read_spell_state.js'
import { use_spell_corpus } from '../../game/data/use_spell_corpus.js'
import { class_spells } from '../../game/screens/hud/fight-spells.js'
import {
  clear_confirmed_spell,
  merge_confirmed,
  spell_alloc_caught_up,
  use_spell_alloc_session,
} from '../../game/screens/hud/spell_alloc_session.js'

type spell_character = Readonly<{
  id: string
  classe?: string | null
  class_id?: string | null
}>

type spell_allocation = Readonly<{
  spent: number
  levels: Record<string, number>
  degraded?: boolean
}>

type spell_allocation_result = Readonly<{
  character_id: string
  class_id: string | null
  corpus: ReadonlyArray<Record<string, any>>
  allocation: spell_allocation
}>

const is_string = (value: string | null): value is string => typeof value === 'string'

/** Read one Character's namespaced SpellLevel fields through the canonical chain door. */
export async function load_encyclopedia_spell_alloc(character: spell_character): Promise<spell_allocation> {
  const class_id = character.classe ?? character.class_id
  const spell_object_ids = class_spells(class_id)
    .map((spell) => spell.object_id)
    .filter(is_string)
  if (!spell_object_ids.length) return { spent: 0, levels: {} }
  return read_spell_state(character.id, spell_object_ids)
}

/**
 * The seat shape encyclopedia detail consumes. A live fight seat is already a composed snapshot and wins
 * immediately; outside a fight, the namespaced read is floored by any just-confirmed grimoire upgrade.
 */
export function use_encyclopedia_spell_seat(character: spell_character | null, fight_seat: any = null) {
  const spell_corpus = use_spell_corpus()
  const [chain_result, set_chain_result] = useState<spell_allocation_result | null>(null)
  const confirmed_by_character = use_spell_alloc_session().confirmed
  const character_id = character?.id ?? null
  const class_id = character?.classe ?? character?.class_id ?? null
  const confirmed = character_id ? (confirmed_by_character[character_id] ?? null) : null
  const chain_alloc =
    chain_result &&
    chain_result.character_id === character_id &&
    chain_result.class_id === class_id &&
    chain_result.corpus === spell_corpus
      ? chain_result.allocation
      : null

  useEffect(() => {
    let live = true
    if (!character_id) return () => {}
    void load_encyclopedia_spell_alloc({ id: character_id, classe: class_id })
      .then((allocation) => {
        if (live) set_chain_result({ character_id, class_id, corpus: spell_corpus, allocation })
      })
      .catch(() => {
        if (live)
          set_chain_result({
            character_id,
            class_id,
            corpus: spell_corpus,
            allocation: { spent: 0, levels: {}, degraded: true },
          })
      })
    return () => {
      live = false
    }
  }, [character_id, class_id, spell_corpus])

  const allocation = useMemo(() => merge_confirmed(chain_alloc, confirmed), [chain_alloc, confirmed])
  useEffect(() => {
    if (character_id && confirmed && spell_alloc_caught_up(chain_alloc, confirmed))
      clear_confirmed_spell(character_id, confirmed)
  }, [chain_alloc, confirmed, character_id])
  return fight_seat ?? (character ? { spell_levels: allocation?.levels ?? {} } : null)
}
