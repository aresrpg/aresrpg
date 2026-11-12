// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Command, Lane } from './control.ts'
import type { CombatRun } from './combat_control.ts'

/** The journal invokes this at every admission, including retained signed-envelope recovery. */
export const assert_combat_admission = (run: CombatRun | null, command: Command, lane: Lane) => {
  const valid =
    run &&
    [
      run.id === command.combat_run_id,
      run.grant_id === command.grant_id,
      run.bot_id === command.bot_id,
      run.last_command_id === command.id,
      lane.combat_run_id === run.id,
      !lane.profession_run_id,
      ['active', 'waiting'].includes(run.status),
      command.payload.fight === run.fight,
      run.profiles.some(({ character_id }) => character_id === command.payload.character_id),
    ].every(Boolean)
  if (!valid) throw new Error('combat_execution_not_authorized')
}
