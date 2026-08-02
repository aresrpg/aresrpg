// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'

import { useFight } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { world_fight_session, world_fight_view } from '../../../../world-shell/fight_session_scope.js'
import { FightSyncBadge, fight_actor_unresolved } from './FightSyncBadge.jsx'

const STATUS_ACTIVE = 1

/** Receipt-owned fight id exists, but the full board document has not reached the reader yet. */
export function FightSyncIndicator() {
  const { t } = useTranslation()
  const syncing = use_dungeon((state) => state.fight_syncing)
  const active = use_dungeon((state) => state.dungeon?.status === STATUS_ACTIVE)
  const world_session = useFight(world_fight_session)
  const fight = useFight(world_fight_view)
  const resolving = fight != null && active && fight_actor_unresolved(fight)
  const world_syncing = world_session && syncing
  return world_syncing || resolving ? (
    <FightSyncBadge label={t(world_syncing ? 'common.loading' : 'dungeons.waiting')} resolving={resolving} />
  ) : null
}
