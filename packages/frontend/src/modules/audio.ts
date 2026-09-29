// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Observe immutable presentation facts, never receipt/packet arrival counts.

import { adventure_completed_quests } from '../adventure/quest.ts'
import { dispose_audio, play_audio } from '../game/audio/audio_registry.ts'
import type { AppModule, AppState } from '../store.ts'

import { fight_result_surface } from './fight_result.ts'
import { fight_level_up_visible, fight_result_available } from './fight_result_view.ts'

export type AudioSnapshot = Readonly<{
  identity: string | null
  ready: boolean
  craft: AppState['session']['craft_result']
  consumption: AppState['session']['consumption_result']
  equipment: Readonly<Record<string, string>>
  points: Readonly<Record<string, number>>
  worlds: Readonly<Record<string, string | null>>
  invitations: readonly string[]
  trade_invitations: readonly string[] | null
  adventure_quests: readonly string[]
  completed_fights: readonly string[]
  levels: readonly string[]
  job_level: string | null
  mastery: Readonly<{ loaded: boolean; quest: string | null; completed: boolean }>
  inventory_open: boolean
}>

const result_notices = (state: AppState) => {
  const results = [
    ...Object.values(state.fight_result.current_by_character),
    ...(state.adventure.result ? [state.adventure.result] : []),
  ]
  const visible = results.filter((result) => fight_result_available(state.fight, result.fight))
  const result_surfaces = visible.filter((result) => fight_result_surface(result) === 'result')
  return Object.freeze({
    completed_fights: result_surfaces.map(({ fight }) => fight),
    levels: visible
      .filter(fight_level_up_visible)
      .map((result) => `${result.fight}:${result.participants[result.own_seat ?? -1]?.character_id}`),
  })
}

const mastery_snapshot = ({ loaded, row }: AppState['mastery']): AudioSnapshot['mastery'] =>
  Object.freeze({
    loaded,
    quest: row ? `${row.id}:${row.quest_epoch}:${row.quest_started_ms}` : null,
    completed: row?.quest_completed ?? false,
  })

const trade_invitation_ids = (state: AppState, identity: string | null): readonly string[] | null =>
  state.trade.loaded
    ? Object.freeze(
        state.trade.rows.filter((row) => row.b === identity && row.phase === 'requested').map(({ id }) => id)
      )
    : null

const selected_cues = (rows: readonly (readonly [string, boolean])[]): readonly string[] =>
  rows.filter(([, enabled]) => enabled).map(([key]) => key)

export const audio_snapshot = (state: AppState): AudioSnapshot => {
  const { session, mastery } = state
  const identity = session.wallet?.address ?? null
  return Object.freeze({
    identity,
    ready: session.link_status === 'ready' && session.roster_loaded,
    craft: session.craft_result ? Object.freeze({ ...session.craft_result }) : null,
    consumption: session.consumption_result ? Object.freeze({ ...session.consumption_result }) : null,
    equipment: Object.freeze(
      Object.fromEntries(
        session.characters.map((character) => [
          character.id,
          character.equipment
            .map(({ slot, id }) => `${slot}:${id}`)
            .sort()
            .join('|'),
        ])
      )
    ),
    points: Object.freeze(
      Object.fromEntries(
        session.characters.map((character) => [
          character.id,
          character.available_points + character.available_spell_points,
        ])
      )
    ),
    worlds: Object.freeze(
      Object.fromEntries(session.characters.map((character) => [character.id, character.world ?? null]))
    ),
    invitations: Object.freeze(
      Object.entries(state.party.invitation_ids_by_character).flatMap(([character, ids]) =>
        ids.map((id) => `${character}:${id}`)
      )
    ),
    trade_invitations: trade_invitation_ids(state, identity),
    ...result_notices(state),
    adventure_quests: adventure_completed_quests(state.adventure),
    job_level: state.job_level_up.current?.id ?? null,
    mastery: mastery_snapshot(mastery),
    inventory_open:
      state.navigation.dialog === 'character_equipment' ||
      (state.navigation.page === 'characters' &&
        ['/characters', '/characters/equipment'].includes(state.navigation.pathname)),
  })
}

const has_added = (before: readonly string[] | null, after: readonly string[] | null): boolean =>
  before !== null && after !== null && after.some((id) => !before.includes(id))

const new_receipt = (
  before: Readonly<{ digest: string }> | null,
  after: Readonly<{ digest: string }> | null
): boolean => after !== null && after.digest !== before?.digest

const changed_existing = <T>(
  before: Readonly<Record<string, T>>,
  after: Readonly<Record<string, T>>,
  changed: (before: T, after: T) => boolean
): boolean => Object.entries(after).some(([key, value]) => Object.hasOwn(before, key) && changed(before[key]!, value))

const reward_cues = (before: AudioSnapshot, after: AudioSnapshot): readonly string[] => {
  return selected_cues([
    ['fight_over', has_added(before.completed_fights, after.completed_fights)],
    ['level_up', has_added(before.levels, after.levels)],
    ['quest_completed', has_added(before.adventure_quests, after.adventure_quests)],
    ['job_level_up', after.job_level !== null && after.job_level !== before.job_level],
  ])
}

const mastery_cues = (before: AudioSnapshot['mastery'], after: AudioSnapshot['mastery']): readonly string[] => {
  if (!before.loaded || !after.loaded || !after.quest) return []
  if (after.quest !== before.quest) return after.completed ? [] : ['quest_started']
  return after.completed && !before.completed ? ['quest_completed'] : []
}

export const game_audio_cues = (before: AudioSnapshot, after: AudioSnapshot): readonly string[] => {
  if (before.identity !== after.identity) return []
  const presentation = reward_cues(before, after)
  if (after.identity === null) return presentation
  if (!before.ready || !after.ready) return []
  const action_cues = selected_cues([
    [after.craft?.successes === 0 ? 'craft_failed' : 'craft_completed', new_receipt(before.craft, after.craft)],
    [
      ['recall', 'city'].includes(after.consumption?.effect ?? '') ? 'teleport' : 'consume',
      new_receipt(before.consumption, after.consumption),
    ],
    ['button_confirm', changed_existing(before.equipment, after.equipment, (a, b) => a !== b)],
    ['power_up', changed_existing(before.points, after.points, (a, b) => b < a)],
    ['teleport', changed_existing(before.worlds, after.worlds, (a, b) => a !== b && a !== null && b !== null)],
    [after.inventory_open ? 'inventory_open' : 'inventory_close', before.inventory_open !== after.inventory_open],
    ['notification', has_added(before.invitations, after.invitations)],
    ['notification', has_added(before.trade_invitations, after.trade_invitations)],
  ])
  return Object.freeze([...new Set([...action_cues, ...presentation, ...mastery_cues(before.mastery, after.mastery)])])
}

export const create_game_audio_observer =
  (emit: (key: string) => void = play_audio): NonNullable<AppModule['observe']> =>
  ({ events, get_state, signal }) => {
    let previous = audio_snapshot(get_state())
    events.on('STATE_UPDATED', (state) => {
      if (signal.aborted) return
      const next = audio_snapshot(state)
      const cues = game_audio_cues(previous, next)
      if (previous.identity !== next.identity) dispose_audio()
      previous = next
      // eslint-disable-next-line functional/prefer-tacit -- forEach supplies an index; the player would interpret it as volume.
      cues.forEach((key) => emit(key))
    })
  }

export default Object.freeze({
  name: 'audio',
  reduce: undefined,
  observe: create_game_audio_observer(),
}) satisfies AppModule
