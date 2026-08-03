// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'

import { useFightVisibleMount, useFightVisibleSync } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { FightSyncBadge } from './FightSyncBadge.jsx'

const STATUS_ACTIVE = 1

/** Receipt-owned fight id exists, but the full board document has not reached the reader yet. */
export function FightSyncIndicator() {
  const { t } = useTranslation()
  const syncing = use_dungeon((state) => state.fight_syncing)
  // RESIDUAL (#1993 carve-out): the chain Dungeon status. `fight_visible_view` is folded from the fight state
  // alone, so it owns no dungeon-lifecycle fact — the same boundary phase.js names in its own declined-migration
  // note. This stays a source read until the dungeon status enters the fight core as a reducer input.
  const active = use_dungeon((state) => state.dungeon?.status === STATUS_ACTIVE)
  // #1993 — the session partition and the actor verdict, both canonical.
  //   · `mount.scope`/`world_active` are `fight_session_scope.js`'s classifier applied to the CORE's session id,
  //     which is the one home (#1799: "presentation projects the session id off the core"); the shell helpers
  //     classify the presentation gate field beside it. A rekey moves only that gate field, and never across
  //     scopes, so the verdict is the same one — read from the home that owns it.
  //   · `sync.actor_unresolved` is the fact this surface used to carry a SECOND copy of (`fight_actor_unresolved`,
  //     deleted with this change): the projection derives it off the same `active_entity_id` and the same fighter
  //     rows, so the copy could only ever agree — until one of the two was edited. `fight_visible_view.test.js`
  //     pins the verdict verbatim against a real fight state, which is where it is now proven.
  const { scope, world_active } = useFightVisibleMount()
  const { actor_unresolved } = useFightVisibleSync()
  const resolving = world_active && active && actor_unresolved
  const world_syncing = scope === 'world' && syncing
  return world_syncing || resolving ? (
    <FightSyncBadge label={t(world_syncing ? 'common.loading' : 'dungeons.waiting')} resolving={resolving} />
  ) : null
}
