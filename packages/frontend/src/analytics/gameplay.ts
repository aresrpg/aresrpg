// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'

import type { AnalyticsEvent } from '../analytics.ts'
import { job_level_changes } from '../modules/job_level_up.ts'
import { content_catalog } from '../content/catalog.ts'
import type { AppState } from '../store.ts'

import { fight_events } from './fights.ts'

const equipped_ids = (character: Readonly<CharacterRow>): string =>
  character.equipment
    .map(({ id, slot }) => `${slot}:${id}`)
    .toSorted()
    .join('|')

const character_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  if (
    previous.session.link_status !== 'ready' ||
    state.session.link_status !== 'ready' ||
    state.session.characters === previous.session.characters
  )
    return []
  return [
    ...job_level_changes(previous.session.characters, state.session.characters).map(
      ({ job, level_before, level_after }) => ({
        name: 'job_level_gained',
        properties: { job, level_before, level_after },
      })
    ),
    ...state.session.characters.flatMap((character): readonly AnalyticsEvent[] => {
      const before = previous.session.characters.find(({ id }) => id === character.id)
      if (!before) return []
      return [
        ...(character.level > before.level
          ? [
              {
                name: 'character_level_gained',
                properties: { level_before: before.level, level_after: character.level },
              },
            ]
          : []),
        ...(equipped_ids(character) !== equipped_ids(before) ? [{ name: 'equipment_changed' }] : []),
        ...(character.dungeon_run && character.dungeon_run.dungeon !== before.dungeon_run?.dungeon
          ? [{ name: 'dungeon_entered' }]
          : []),
      ]
    }),
  ]
}

const gathering_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  if (state.world.gathering === previous.world.gathering) return []
  return Object.values(state.world.gathering).flatMap((gathering): readonly AnalyticsEvent[] => {
    const before = previous.world.gathering[gathering.character_id]
    if (!before) return []
    if (![before.attempt_id === gathering.attempt_id, !before.confirmed, gathering.confirmed].every(Boolean)) return []
    const automatic = previous.automation.run?.character_id === gathering.character_id
    const character = state.session.characters.find(({ id }) => id === gathering.character_id)
    const job = content_catalog
      .world(character?.world ?? '')
      ?.resources.find(({ item_type }) => item_type === gathering.item_type)?.job
    return [
      {
        name: 'gather_completed',
        properties: {
          output_type: gathering.item_type,
          quantity: gathering.quantity ?? 0,
          ...(job ? { job } : {}),
          control: automatic ? 'automatic' : 'manual',
        },
      },
    ]
  })
}

const movement_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const next = state.analytics
  const before = previous.analytics
  return [
    ...(next.moved_at !== null && next.moved_at !== before.moved_at
      ? [{ name: 'movement_active', properties: { control: 'manual' } }]
      : []),
    ...(next.active && next.active !== before.active
      ? [{ name: 'gameplay_active', properties: { activity: next.active.activity, control: 'manual' } }]
      : []),
  ]
}

const loading_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  const next = state.analytics.loading
  const before = previous.analytics.loading
  if (!next || next === before) return []
  return [
    ...(next.world !== before?.world ? [{ name: 'world_load_started' }] : []),
    ...(next.stage === 'ready' ? [{ name: 'world_playable', properties: { duration_ms: next.duration_ms } }] : []),
    ...(next.stage === 'failed' ? [{ name: 'world_load_failed', properties: { duration_ms: next.duration_ms } }] : []),
  ]
}

export const gameplay_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] => {
  if (!state.session.wallet || state.session.wallet !== previous.session.wallet) return []
  return [
    ...fight_events(state, previous),
    ...gathering_events(state, previous),
    ...character_events(state, previous),
    ...movement_events(state, previous),
    ...loading_events(state, previous),
    ...(state.navigation.page !== previous.navigation.page
      ? [{ name: 'feature_opened', properties: { surface: state.navigation.page } }]
      : []),
    ...(previous.session.link_status === 'ready' && state.session.link_status !== 'ready'
      ? [{ name: 'connection_interrupted' }]
      : []),
    ...(previous.session.link_status !== 'ready' && state.session.link_status === 'ready'
      ? [{ name: 'connection_ready' }]
      : []),
  ]
}
