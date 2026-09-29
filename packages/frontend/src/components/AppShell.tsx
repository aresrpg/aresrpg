// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useSyncExternalStore } from 'react'

import type { PlayerShellProps } from '../player_presentation.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'
import { read_scene, subscribe_scene } from '../game/core/scene_feed.ts'
import { useAppStore } from '../store.ts'

import { SessionReplacedModal } from './SessionReplacedModal.tsx'
import { MaintenanceModal } from './MaintenanceModal.tsx'
import { TradeInbox } from './TradeInbox.tsx'
import { GamePageWindow } from './GamePageWindow.tsx'
/** The GAME's fight surface, mounted in the world the engine module owns. This is the ONE place
 *  that reads the game's scene lane — everything downstream receives the handle as an argument,
 *  so no component can wander into a world that is not its own. */
const GameFightLayer = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const scene = useSyncExternalStore(subscribe_scene, read_scene, () => null)
  const mounted = useAppStore((state) => state.fight.mounted)
  const environment_key = useAppStore((state) => state.fight.checkpoint?.contract.id ?? 'loading')
  const nearby_id = useAppStore((state) => state.fight.nearby?.fight)
  // a previewing modal hydrates the session without mounting the board — mounting is the COMMIT
  if (!scene) return null
  if (mounted) return <FightLayer key={environment_key} copy={copy} scene={scene} />
  return nearby_id ? <FightLayer key={`nearby:${nearby_id}`} nearby_id={nearby_id} copy={copy} scene={scene} /> : null
}

export const AppShell = ({ copy, page, session }: PlayerShellProps) => (
  <div className="app-shell pointer-events-none fixed inset-0 z-[10] flex flex-col" data-app-content="">
    {session.link_status === 'replaced' && <SessionReplacedModal copy={copy} />}
    {session.game_frozen === true && !['admin', 'kares'].includes(page) && <MaintenanceModal copy={copy} />}
    <TradeInbox copy={copy} />
    <GamePageWindow copy={copy} />
    <GameFightLayer copy={copy} />
  </div>
)
