// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { content_catalog, type WorldResource } from '../content/catalog.ts'
import type { WorldPose } from '../game/core/pose_feed.ts'
import type { AppState } from '../store.ts'

/** The resource node Collect All gathers, in the zone `key`. */
export type AutomationTarget = Readonly<{ key: string; x: number; z: number; node: string }>

export type AutomationStep =
  | Readonly<{ type: 'inspecting'; target: AutomationTarget }>
  | Readonly<{ type: 'retrying'; target: AutomationTarget; retry_at_ms: number }>
  | Readonly<{
      type: 'gathering'
      target: AutomationTarget
      nodes_before: number
      anchor_at_ms: number
      seed: string
      attempt_id: string | null
      confirmed: boolean
    }>

/** One Collect All: the pack it empties, node by node, and how many nodes it had at the start. */
export type AutomationRun = Readonly<{
  id: string
  character_id: string
  world: string
  item_type: string
  target: AutomationTarget
  nodes: number
  step: AutomationStep
}>
export type AutomationState = Readonly<{ run: AutomationRun | null }>
export type AutomationInput =
  | Readonly<{ type: 'automation/collect_all'; id: string; node: string; pose: WorldPose | null }>
  | Readonly<{ type: 'automation/stop' }>
  | Readonly<{ type: 'automation/tick'; world_ms: number | null; monotonic_ms: number; pose: WorldPose | null }>

export const initial_automation_state = (): AutomationState => ({ run: null })
export const with_automation_run = (state: AppState, run: AutomationRun | null): AppState => ({
  ...state,
  automation: { run },
})
export const stop_automation = (state: AppState): AppState =>
  state.automation.run ? with_automation_run(state, null) : state

/** A failure that names a retry moment waits for it; any other failure ends the run. */
export const retry_automation = (
  state: AppState,
  run: AutomationRun,
  target: AutomationTarget,
  retry_at_ms: number | undefined
): AppState =>
  retry_at_ms === undefined
    ? stop_automation(state)
    : with_automation_run(state, { ...run, step: { type: 'retrying', target, retry_at_ms } })

export const gathering_resources = (world: string | null): readonly WorldResource[] =>
  content_catalog.world(world ?? '')?.resources ?? []
