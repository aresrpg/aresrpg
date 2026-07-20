// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Multi-character transaction orchestration. Every loop delegates to the existing single-character self-pay seam,
// awaits its receipt, then advances. A refusal propagates immediately: no later member runs and no tx is retried.

import { activate_run, join_room_fight, join_world_fight, settle_run_and_open } from './dungeon_actions.js'
import { create_owned_team_actions } from './owned_team_actions_core.js'

const owned_team_actions = create_owned_team_actions({
  join_world_fight,
  activate_run,
  join_room_fight,
  settle_run_and_open,
})

export const {
  join_owned_world_fight,
  activate_owned_dungeon_runs,
  join_owned_dungeon_room_fight,
  settle_owned_dungeon_runs,
} = owned_team_actions
