// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Certified forgemagie outcomes retained for this authenticated app session. Chain Item rows
// remain truth; this bounded ledger explains how each visible stat and puits delta happened.

import { stat_names, type StatName } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'
import type { ScribeOutcome } from '@aresrpg/sdk/auth'

import type { AppInput, AppModule, AppState } from '../store.ts'

const HISTORY_LIMIT = 30

export type ScribeOutcomeKind = 'critical_success' | 'neutral_success' | 'critical_failure'

export type ScribeHistoryEntry = Readonly<{
  digest: string
  rune_item_type: string
  outcome: ScribeOutcomeKind
  applied_stat: StatName
  applied_value: number
  lost_stat: StatName | null
  lost_amount: number
  puits_before: number
  puits_after: number
}>

export type RuneforgeState = Readonly<{
  history_by_gear: Readonly<Record<string, readonly ScribeHistoryEntry[]>>
}>

export type RuneforgeInput = Readonly<{
  type: 'runeforge/scribed'
  gear_before: Readonly<ItemRow>
  rune_before: Readonly<ItemRow>
  outcome: ScribeOutcome
}>

export const initial_runeforge_state = (): RuneforgeState => Object.freeze({ history_by_gear: Object.freeze({}) })

export const scribe_outcome_kind = (outcome: number): ScribeOutcomeKind =>
  outcome === 0 ? 'critical_success' : outcome === 1 ? 'neutral_success' : 'critical_failure'

const history_entry = (input: Readonly<RuneforgeInput>): ScribeHistoryEntry =>
  Object.freeze({
    digest: input.outcome.digest,
    rune_item_type: input.rune_before.item_type,
    outcome: scribe_outcome_kind(input.outcome.outcome),
    applied_stat: stat_names[input.outcome.stat]!,
    applied_value: input.outcome.applied_value,
    lost_stat: stat_names[input.outcome.lost_stat] ?? null,
    lost_amount: input.outcome.lost_amount,
    puits_before: Number(input.gear_before.puits ?? 0),
    puits_after: input.outcome.new_puits,
  })

export const reduce_runeforge = (state: RuneforgeState, input: Readonly<RuneforgeInput>): RuneforgeState => {
  const current = state.history_by_gear[input.gear_before.id] ?? []
  if (current.some(({ digest }) => digest === input.outcome.digest)) return state
  return Object.freeze({
    history_by_gear: Object.freeze({
      ...state.history_by_gear,
      [input.gear_before.id]: Object.freeze([history_entry(input), ...current].slice(0, HISTORY_LIMIT)),
    }),
  })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected') {
    if (Object.keys(state.runeforge.history_by_gear).length === 0) return state
    return Object.freeze({ ...state, runeforge: initial_runeforge_state() })
  }
  if (input.type !== 'runeforge/scribed') return state
  const runeforge = reduce_runeforge(state.runeforge, input)
  return runeforge === state.runeforge ? state : Object.freeze({ ...state, runeforge })
}

const runeforge: AppModule = Object.freeze({ name: 'runeforge', reduce })

export default runeforge
