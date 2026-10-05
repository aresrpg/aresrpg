// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import source from '../../../../seed/content/journey.json'

export type JourneyQuest = Readonly<{
  id: string
  chapter: string
  item: string
  kind: 'start' | 'own' | 'harvest' | 'dungeon' | 'tutorial' | 'hunt' | 'materials' | 'craft' | 'map'
  dungeon?: string
  mob?: string
  /** Optional learning steps retire once their practical milestone is already achieved. */
  superseded_by?: string
}>

export const JOURNEY_QUESTS: readonly JourneyQuest[] = source as readonly JourneyQuest[]

export const relevant_quests = (
  completed: readonly string[],
  quests: readonly JourneyQuest[] = JOURNEY_QUESTS
): readonly JourneyQuest[] =>
  quests.filter((quest) => completed.includes(quest.id) || !completed.includes(quest.superseded_by ?? ''))

export const completed_quests_from = (value: unknown): readonly string[] =>
  Object.freeze(JOURNEY_QUESTS.filter(({ id }) => Array.isArray(value) && value.includes(id)).map(({ id }) => id))

export const next_quest = (
  completed: readonly string[],
  quests: readonly JourneyQuest[] = JOURNEY_QUESTS
): JourneyQuest | null => relevant_quests(completed, quests).find(({ id }) => !completed.includes(id)) ?? null

export type JourneyState = Readonly<{
  identity: string | null
  generation: number
  ready: boolean
  saving: boolean
  completed: readonly string[]
  celebrations: readonly string[]
  journal_open: boolean
  collapsed: boolean
  storage_failed: boolean
}>

export const initial_journey_state = (identity: string | null = null, generation = 0): JourneyState =>
  Object.freeze({
    identity,
    generation,
    ready: false,
    saving: false,
    completed: [],
    celebrations: [],
    journal_open: false,
    collapsed: false,
    storage_failed: false,
  })

export const complete_quests = (state: JourneyState, ids: readonly string[], celebrate = true): JourneyState => {
  const added = completed_quests_from(ids).filter((id) => !state.completed.includes(id))
  if (!added.length) return state
  return Object.freeze({
    ...state,
    completed: completed_quests_from([...state.completed, ...added]),
    saving: !state.storage_failed,
    celebrations: celebrate ? [...state.celebrations, ...added.filter((id) => id !== 'welcome')] : state.celebrations,
  })
}

export const journey_complete = (journey: JourneyState): boolean =>
  journey.identity !== null && journey.ready && !journey.saving && next_quest(journey.completed) === null
