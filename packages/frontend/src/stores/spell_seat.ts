// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One reducer-owned composition for a Character's chain spell allocation. Every grimoire surface derives from
// this seat so id filtering, request staleness, receipt flooring, caught-up clearing, and refetch all stay one fact.

import { useCallback, useEffect, useMemo, useReducer } from 'react'

import { read_spell_state } from '../chain/read_spell_state.js'
import { use_spell_corpus } from '../game/data/use_spell_corpus.js'
import { class_spells } from '../game/screens/hud/fight-spells.js'
import {
  clear_confirmed_spell,
  merge_confirmed,
  spell_alloc_caught_up,
  use_spell_alloc_session,
} from '../game/screens/hud/spell_alloc_session.js'

export type spell_character = Readonly<{
  id: string
  classe?: string | null
  class_id?: string | null
}>

export type spell_allocation = Readonly<{
  spent: number
  levels: Record<string, number>
  degraded?: boolean
}>

type read_state = Readonly<{
  request: object | null
  character_id: string | null
  class_id: string | null
  corpus: unknown
  allocation: spell_allocation | null
}>

type read_action =
  | Readonly<{
      type: 'started'
      request: object
      character_id: string
      class_id: string | null
      corpus: unknown
    }>
  | Readonly<{
      type: 'settled'
      request: object
      allocation: spell_allocation
    }>
  | Readonly<{
      type: 'cancelled'
      request: object
    }>

const initial_read: read_state = {
  request: null,
  character_id: null,
  class_id: null,
  corpus: null,
  allocation: null,
}

function reduce_read(state: read_state, action: read_action): read_state {
  if (action.type === 'settled')
    return action.request === state.request ? { ...state, request: null, allocation: action.allocation } : state
  if (action.type === 'cancelled') return action.request === state.request ? { ...state, request: null } : state

  const same_seat =
    state.character_id === action.character_id && state.class_id === action.class_id && state.corpus === action.corpus
  return {
    request: action.request,
    character_id: action.character_id,
    class_id: action.class_id,
    corpus: action.corpus,
    allocation: same_seat ? state.allocation : null,
  }
}

const is_string = (value: string | null | undefined): value is string => typeof value === 'string'

/** Read one Character's namespaced SpellLevel fields through the canonical chain door. */
export async function load_spell_alloc(character: spell_character): Promise<spell_allocation> {
  const class_id = character.classe ?? character.class_id
  const spell_object_ids = class_spells(class_id)
    .map((spell) => spell.object_id)
    .filter(is_string)
  if (!spell_object_ids.length) return { spent: 0, levels: {} }
  return read_spell_state(character.id, spell_object_ids)
}

/**
 * Compose the current chain read with the receipt-proven floor. The reducer rejects late requests for both a
 * replaced Character/class/corpus seat and an earlier same-seat refetch.
 */
export function use_spell_seat(character: spell_character | null) {
  const spell_corpus = use_spell_corpus()
  const [read, dispatch] = useReducer(reduce_read, initial_read)
  const confirmed_by_character = use_spell_alloc_session().confirmed
  const character_id = character?.id ?? null
  const class_id = character?.classe ?? character?.class_id ?? null
  const confirmed = character_id ? (confirmed_by_character[character_id] ?? null) : null
  const chain_allocation =
    read.character_id === character_id && read.class_id === class_id && read.corpus === spell_corpus
      ? read.allocation
      : null

  const refetch = useCallback(() => {
    if (!character_id) return
    const request = {}
    dispatch({ type: 'started', request, character_id, class_id, corpus: spell_corpus })
    const settle = (allocation: spell_allocation) => dispatch({ type: 'settled', request, allocation })
    void load_spell_alloc({ id: character_id, classe: class_id })
      .catch(() => ({ spent: 0, levels: {}, degraded: true }))
      .then(settle)
    return dispatch.bind(null, { type: 'cancelled', request })
  }, [character_id, class_id, spell_corpus])

  useEffect(() => refetch(), [refetch])

  const allocation = useMemo(() => merge_confirmed(chain_allocation, confirmed), [chain_allocation, confirmed])
  useEffect(() => {
    if (character_id && confirmed && spell_alloc_caught_up(chain_allocation, confirmed))
      clear_confirmed_spell(character_id, confirmed)
  }, [chain_allocation, confirmed, character_id])

  return { allocation, chain_allocation, confirmed, refetch }
}
