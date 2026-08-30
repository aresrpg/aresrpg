// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Page } from '../modules/navigation.ts'

export const TUTORIAL_IDS = Object.freeze([
  'world',
  'fight',
  'characters_equipment',
  'characters_stats',
  'characters_spells',
  'characters_jobs',
  'characters_runeforge',
] as const)

export type TutorialId = (typeof TUTORIAL_IDS)[number]
export type TutorialTargetName =
  | 'compass'
  | 'overworld_hud'
  | 'fps'
  | 'character_tabs'
  | 'character_equipment'
  | 'shared_inventory'
  | 'character_stats'
  | 'character_spells'
  | 'character_jobs'
  | 'character_runeforge'
export type TutorialTarget = Readonly<{ kind: 'dom'; name: TutorialTargetName }> | Readonly<{ kind: 'entity' }>
export type TutorialStep = Readonly<{ key: string; target: TutorialTarget | null }>

const dom = (name: TutorialTargetName): TutorialTarget => Object.freeze({ kind: 'dom', name })

const STEPS: Readonly<Record<TutorialId, readonly TutorialStep[]>> = Object.freeze({
  world: Object.freeze([
    Object.freeze({ key: 'world_compass', target: dom('compass') }),
    Object.freeze({ key: 'world_hud', target: dom('overworld_hud') }),
    Object.freeze({ key: 'world_fps', target: dom('fps') }),
    Object.freeze({ key: 'world_character', target: Object.freeze({ kind: 'entity' as const }) }),
    Object.freeze({ key: 'world_character_tabs', target: dom('character_tabs') }),
  ]),
  fight: Object.freeze([Object.freeze({ key: 'fight', target: null })]),
  characters_equipment: Object.freeze([
    Object.freeze({ key: 'equipment_gear', target: dom('character_equipment') }),
    Object.freeze({ key: 'equipment_inventory', target: dom('shared_inventory') }),
  ]),
  characters_stats: Object.freeze([Object.freeze({ key: 'stats', target: dom('character_stats') })]),
  characters_spells: Object.freeze([Object.freeze({ key: 'spells', target: dom('character_spells') })]),
  characters_jobs: Object.freeze([Object.freeze({ key: 'jobs', target: dom('character_jobs') })]),
  characters_runeforge: Object.freeze([Object.freeze({ key: 'runeforge', target: dom('character_runeforge') })]),
})

export const tutorial_steps = (id: TutorialId): readonly TutorialStep[] => STEPS[id]

const is_tutorial_id = (value: unknown): value is TutorialId =>
  typeof value === 'string' && TUTORIAL_IDS.some((id) => id === value)

export const completed_tutorials_from = (value: unknown): readonly TutorialId[] =>
  Array.isArray(value)
    ? Object.freeze(
        value.reduce<TutorialId[]>(
          (completed, candidate) =>
            is_tutorial_id(candidate) && !completed.includes(candidate) ? [...completed, candidate] : completed,
          []
        )
      )
    : Object.freeze([])

export type TutorialFacts = Readonly<{
  page: Page
  pathname: string
  dialog_open: boolean
  player_ready: boolean
  selected_character_id: string | null
  fight_mounted: boolean
  fight_owned: boolean
  world_available: boolean
}>

const character_tutorial = (pathname: string): TutorialId => {
  const detail = pathname.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean)[1]
  if (detail === 'stats' || detail === 'spells' || detail === 'jobs' || detail === 'runeforge')
    return `characters_${detail}`
  return 'characters_equipment'
}

const tutorial_candidate = (facts: Readonly<TutorialFacts>): TutorialId | null => {
  if (facts.fight_mounted) return facts.fight_owned ? 'fight' : null
  if (facts.page === 'world' && facts.world_available) return 'world'
  if (facts.page === 'characters') return character_tutorial(facts.pathname)
  return null
}

export const tutorial_id_for = (
  facts: Readonly<TutorialFacts>,
  completed: readonly TutorialId[]
): TutorialId | null => {
  if (!facts.player_ready || facts.dialog_open || !facts.selected_character_id) return null
  const candidate = tutorial_candidate(facts)
  return candidate && !completed.includes(candidate) ? candidate : null
}
