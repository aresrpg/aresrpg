// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, IconButton } from '@aresrpg/ui'
import { Eye, Footprints, Swords } from 'lucide-react'
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import type { FightRow } from '@aresrpg/protocol'
import { useState } from 'react'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import { selected_character } from '../../modules/session.ts'
import { run_to_available } from '../../modules/run_to.ts'
import { sword_fights } from '../../modules/world_engage.ts'
import { useWorldPose, type WorldPose } from '../core/pose_feed.ts'

export const nearby_fights = (
  fights: Readonly<Record<string, FightRow>>,
  world: string | null,
  pose: WorldPose | null
) =>
  pose
    ? sword_fights(fights, world)
        .map((fight) => ({
          fight,
          distance: Math.hypot(
            chain_to_client_coordinate(fight.x) - pose.x,
            chain_to_client_coordinate(fight.z) - pose.z
          ),
        }))
        .sort((a, b) => a.distance - b.distance || a.fight.id.localeCompare(b.fight.id))
    : []

export const MultiplayerHud = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const fights = useAppStore((state) => state.world.fights)
  const players = useAppStore((state) => state.world.players)
  const character = useAppStore((state) => selected_character(state.session))
  const can_run = useAppStore(run_to_available)
  const pose = useWorldPose()
  const [expanded, set_expanded] = useState(false)
  const rows = nearby_fights(fights, character?.world ?? null, pose?.character_id === character?.id ? pose : null)
  const text = copy_text(copy.ui)
  return (
    <section className="world-multiplayer" aria-label={text('multiplayer')}>
      <header>
        <Button aria-expanded={expanded} onClick={() => set_expanded(!expanded)}>
          <Swords size={15} /> {text('nearby_fights')} <b>{rows.length}</b>
        </Button>
        <Button
          onClick={() => {
            dispatch_app({ type: 'page/open', page: 'kolizeum' })
          }}
        >
          {copy.kolizeum}
        </Button>
      </header>
      <div className="world-nearby-fights" data-expanded={expanded}>
        {rows.length === 0 && <p>{text('nearby_fights_empty')}</p>}
        {rows.map(({ fight, distance }) => (
          <div className="world-nearby-fight" key={fight.id}>
            <span>
              <b>{(fight.opener_a && players[fight.opener_a]?.name) || copy.world_hud.fight_unknown}</b>
              <small>
                {text('meters', { count: Math.ceil(distance) })} ·{' '}
                {fight.phase === 'placement' ? copy.world_hud.fight_placement : copy.world_hud.fight_spectate_title}
              </small>
            </span>
            <IconButton
              label={copy.world_hud.fight_spectate_button}
              icon={<Eye />}
              disabled={!character}
              onClick={() => dispatch_app({ type: 'dialog/open', dialog: `fight:${fight.id}` })}
            />
            {fight.phase === 'placement' && (
              <IconButton
                label={text('run_and_join')}
                icon={<Footprints />}
                disabled={!can_run}
                onClick={() => {
                  dispatch_app({ type: 'run_to/fight', fight_id: fight.id })
                  set_expanded(false)
                }}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
