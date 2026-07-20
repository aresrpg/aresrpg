import { useTranslation } from 'react-i18next'

import { use_fight_view } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { FightSyncBadge, fight_actor_unresolved } from './FightSyncBadge.jsx'

const STATUS_ACTIVE = 1

/** Receipt-owned fight id exists, but the full board document has not reached the reader yet. */
export function FightSyncIndicator() {
  const { t } = useTranslation()
  const syncing = use_dungeon((state) => state.fight_syncing)
  const active = use_dungeon((state) => state.dungeon?.status === STATUS_ACTIVE)
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const resolving = active && fight_actor_unresolved(fight)
  return syncing || resolving ? (
    <FightSyncBadge label={t(syncing ? 'common.loading' : 'dungeons.waiting')} resolving={resolving} />
  ) : null
}
