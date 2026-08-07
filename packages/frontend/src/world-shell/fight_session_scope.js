// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight core is app-wide because WORLD and SIM reuse the same reducer and renderer. Session identity is
// nevertheless mode-partitioned: simulator ids live under the canonical `sim:` namespace, while chain Fight
// object ids do not. Every shell/render decision asks this one classifier instead of treating any adopted view
// in the singleton as its own.

import { engine_view_of } from '@aresrpg/fight/project'
import { fight_scope_of_id, fight_scope_sim, fight_scope_world } from '@aresrpg/fight/session_scope'

export { fight_scope_sim, fight_scope_world }

/** @param {any} fight_state @returns {'world' | 'sim' | null} */
export const fight_scope_of = (fight_state) => {
  return fight_scope_of_id(fight_state?.fight_id)
}

/** Whether the singleton currently belongs to one mode, including its pre-view opening window. */
export const fight_session_in_scope = (fight_state, scope) => fight_scope_of(fight_state) === scope

/**
 * A session is render-active only after its board view has been adopted, matching the old `fight_view()!=null`
 * gate. Scope is an additional partition, not a weaker definition of "active".
 * @param {any} fight_state
 * @param {'world' | 'sim'} scope
 */
export const fight_active_in_scope = (fight_state, scope) =>
  fight_state?.view != null && fight_session_in_scope(fight_state, scope)

/** The accepted scope's memoized engine view, or null when another mode owns the singleton. */
export const fight_view_in_scope = (fight_state, scope) =>
  fight_active_in_scope(fight_state, scope) ? engine_view_of(fight_state) : null

/** The WORLD shell's single "is a fight active?" predicate. @param {any} fight_state */
export const world_fight_active = (fight_state) => fight_active_in_scope(fight_state, fight_scope_world)

/** Whether the fight singleton currently belongs to the WORLD shell. @param {any} fight_state */
export const world_fight_session = (fight_state) => fight_session_in_scope(fight_state, fight_scope_world)

/** The WORLD shell's scoped fight projection. @param {any} fight_state */
export const world_fight_view = (fight_state) => fight_view_in_scope(fight_state, fight_scope_world)
