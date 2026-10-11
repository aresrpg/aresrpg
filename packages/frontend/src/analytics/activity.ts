// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WorldPose } from '../game/core/pose_feed.ts'
import type { AppState } from '../store.ts'

export const ACTIVITY_INTERVAL_MS = 60_000

export type MovementSample = Readonly<{
  character: string
  world: string
  x: number
  z: number
  at_ms: number
  manual: boolean
}>

/** Sampling gaps, scene changes and corrections establish a baseline; they are not walking. */
export const manually_moved = (before: MovementSample | null, next: MovementSample): boolean => {
  if (!before) return false
  const elapsed = next.at_ms - before.at_ms
  const distance = Math.hypot(next.x - before.x, next.z - before.z)
  return [
    before.manual,
    next.manual,
    before.character === next.character,
    before.world === next.world,
    elapsed > 0,
    elapsed <= 2_000,
    distance >= 0.25,
    distance <= (elapsed / 1_000) * 30,
  ].every(Boolean)
}

export const activity_due = (before: number | null, now: number): boolean =>
  before === null || now - before >= ACTIVITY_INTERVAL_MS

export const movement_sample = (
  state: AppState,
  pose: WorldPose | null,
  at_ms: number,
  visible: boolean
): MovementSample | null => {
  const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!character?.world || !pose) return null
  const ready = [
    visible,
    state.session.link_status === 'ready',
    pose.character_id === character.id,
    state.analytics.loading?.world === character.world,
    state.analytics.loading?.stage === 'ready',
  ].every(Boolean)
  if (!ready) return null
  return {
    character: character.id,
    world: character.world,
    x: pose.x,
    z: pose.z,
    at_ms,
    manual: [pose.manual_movement === true, !state.fight.mounted].every(Boolean),
  }
}

/** A single definition of meaningful return activity. Automation and idle presence never qualify. */
const ENGAGEMENT_ACTIVITIES: Readonly<Record<string, string>> = {
  movement_active: 'movement',
  gather_completed: 'gathering',
  craft_completed: 'crafting',
  fight_started: 'combat',
  fight_turn_completed: 'combat',
}

export const engagement_activity = (
  name: string,
  properties: Readonly<Record<string, unknown>> = {}
): string | null => {
  return properties.control === 'automatic' ? null : (ENGAGEMENT_ACTIVITIES[name] ?? null)
}
