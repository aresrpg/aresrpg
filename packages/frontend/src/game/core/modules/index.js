// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The client module pipeline (reducer/observer system). Each module is a factory
// `() => { reduce?, observe? }`. Order matters only if reducers depend on each other's
// output within a single action; today they're independent. Grows per stage.

import sui_session from './sui_session.js'
import chat from './chat.js'
import player from './player.js'
import presence from './presence.js'
import mob_groups from './mob_groups.js'
import resource_nodes from './resource_nodes.js'
import fight from './fight.js'
import player_experience from './player_experience.js'
import job_progression from './job_progression.js'
import quests from './quests.js'

/** @type {import('../game.js').Module[]} */
export const MODULES = [
  sui_session,
  chat,
  player,
  presence,
  mob_groups,
  resource_nodes,
  fight,
  player_experience,
  job_progression,
  quests,
]
