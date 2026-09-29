// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppState } from '../store.ts'
import type { create_world } from '../game/core/world.ts'

import { is_world_page } from './navigation.ts'
import { selected_world_action_lock } from './world_gather.ts'

type WorldActivity = Pick<ReturnType<typeof create_world>, 'set_active' | 'set_interactive' | 'set_action_lock'>

export const sync_world_activity = (world: Readonly<WorldActivity> | null, state: AppState): void => {
  if (!world) return
  const world_page = is_world_page(state.navigation.page)
  const background = state.automation.run !== null || state.run_to.run?.status === 'running'
  world.set_active(true, background)
  world.set_interactive(world_page && state.navigation.dialog === null && !!state.session.wallet)
  world.set_action_lock(selected_world_action_lock(state))
}
