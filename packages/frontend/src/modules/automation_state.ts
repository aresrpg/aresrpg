// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WorldPose } from '../game/core/pose_feed.ts'
import type { AppState } from '../store.ts'

import type { AutomationTarget, VisitedZones } from './automation_route.ts'
import type { ZoneSearchTarget } from './world.ts'

export type AutomationStep =
  | Readonly<{ type: 'planning' }>
  | Readonly<{ type: 'moving'; target: AutomationTarget }>
  | Readonly<{ type: 'inspecting'; target: AutomationTarget }>
  | Readonly<{ type: 'searching'; target: ZoneSearchTarget }>
  | Readonly<{ type: 'retrying'; target: AutomationTarget; retry_at_ms: number }>
  | Readonly<{
      type: 'gathering'
      target: AutomationTarget
      nodes_before: number
      seed: string
      attempt_id: string | null
      confirmed: boolean
      fight: string | null
      fighter: bigint | null
      forfeit: 'idle' | 'pending' | 'confirmed'
    }>
  | Readonly<{ type: 'waiting'; until_ms: number }>

export type AutomationRun = Readonly<{
  id: string
  character_id: string
  world: string
  item_type: string
  visited: VisitedZones
  step: AutomationStep
}>
export type AutomationReason = 'stopped' | 'unavailable' | 'blocked' | 'failed'
export type AutomationState = Readonly<{
  unlocked: boolean
  item_type: string
  quantity: number
  reason: AutomationReason | null
  run: AutomationRun | null
}>
export type AutomationInput =
  | Readonly<{ type: 'automation/unlocked' }>
  | Readonly<{ type: 'automation/resource'; item_type: string }>
  | Readonly<{ type: 'automation/start'; id: string }>
  | Readonly<{ type: 'automation/stop'; reason: AutomationReason }>
  | Readonly<{ type: 'automation/tick'; world_ms: number | null; monotonic_ms: number; pose: WorldPose | null }>

export const initial_automation_state = (): AutomationState => ({
  unlocked: false,
  item_type: '',
  quantity: 0,
  reason: null,
  run: null,
})
export const with_automation = (state: AppState, automation: AutomationState): AppState => ({ ...state, automation })
export const with_automation_run = (state: AppState, run: AutomationRun): AppState =>
  with_automation(state, { ...state.automation, run })
export const stop_automation = (state: AppState, reason: AutomationReason): AppState =>
  with_automation(state, { ...state.automation, run: null, reason })

export const retry_automation = (
  state: AppState,
  run: AutomationRun,
  target: AutomationTarget,
  retry_at_ms: number | undefined
): AppState =>
  retry_at_ms === undefined
    ? stop_automation(state, 'failed')
    : with_automation_run(state, { ...run, step: { type: 'retrying', target, retry_at_ms } })
