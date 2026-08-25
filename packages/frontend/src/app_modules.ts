// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The two arming sets, one home. The separation is load-bearing: the player app must never arm
// the seed editor (its dev-server reloads would ride a live session), and the /demo lab must
// never arm the session/link stack (editing owes nothing to any wallet). Sealed by
// test/core/app_modules.test.ts.

import type { AppModuleName } from './store.ts'

export const PLAYER_APP_MODULES = Object.freeze([
  'session',
  'navigation',
  'settings',
  'locale',
  'engine',
  'fight',
  'admin',
  // the chat observer folds incoming packet/chat_message into chat lines — reducers always
  // run, but an observer only listens when armed here (2026-08-20: chat was missing, so
  // everyone's messages published fine and nobody ever saw them)
  'chat',
  // the duel's challenge transaction and its invitation prompt, and the remote fight's chain
  // submissions, are observer effects — unarmed they are the same silent death as chat above
  // (2026-08-21: challenging a duel did nothing at all; every test armed them and stayed green)
  'duel',
  'fight_chain',
  'fight_result',
  // the silent claimer settles loot-box/crush claims during the reveal — unarmed, the card
  // spins on "Collecting…" forever (2026-08-21, the THIRD kill of this class in two days)
  'claims',
  // the world observer fires the zone-search transaction — the FOURTH member of the class the
  // comments above name: its reducer folds the stream whether or not it is listed here, so an
  // unarmed world module leaves the discovery prompt pressing a key that does nothing at all
  'world',
  'dungeon',
  'marketplace',
]) satisfies readonly AppModuleName[]

export const DEMO_APP_MODULES = Object.freeze([
  'settings',
  'simulator',
  'fight',
  'editor',
]) satisfies readonly AppModuleName[]
