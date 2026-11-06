// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import { WorldStatus } from '../components/WorldStatus.tsx'
import { PartyFrame } from '../components/PartyFrame.tsx'
import { selected_party } from '../modules/party.ts'
import { Minimap } from '../game/hud/Minimap.tsx'
import { CompassStrip } from '../game/hud/CompassStrip.tsx'
import { OverworldVitals } from '../game/hud/OverworldVitals.tsx'
import { CharacterTabs } from '../components/CharacterTabs.tsx'
import { character_icon } from '../content/assets.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { AgentFunding } from './AgentFunding.tsx'
import { displayed_character } from './observation.ts'
import './spectator.css'

export const AgentSpectator = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const party = useAppStore(selected_party)
  const fighting = useAppStore((state) => state.fight.mounted)
  const character = displayed_character(session)
  const view = session.agent_view
  const characters = [
    ...session.characters,
    ...view.characters.filter((row) => !session.characters.some((owned) => owned.id === row.id)),
  ]
  const status =
    view.status === 'failed'
      ? copy.ui.agent_watch_failed
      : view.status === 'loading' || session.link_status !== 'ready'
        ? copy.server_connecting
        : view.characters.length === 0
          ? copy.ui.agent_watch_empty
          : copy.ui.agent_watching
  return (
    <>
      <div className="agent-spectator" data-agent-spectator="">
        <WorldStatus copy={copy} party_available={false}>
          <CharacterTabs
            characters={characters}
            selected_character_id={session.selected_character_id}
            copy={copy}
            create_character={null}
            select_character={(character_id) => dispatch_app({ type: 'character/select', character_id })}
          />
          <Button
            className="pointer-events-auto"
            onClick={() => dispatch_app({ type: 'agent/watch', observation: null })}
          >
            {copy.fight_hud.stop_spectating}
          </Button>
          <span className="agent-spectator-status" role="status">
            {status}
          </span>
          <AgentFunding key={`${session.wallet?.address}:${view.serial}`} copy={copy} />
        </WorldStatus>
        <CompassStrip copy={copy} />
        <aside className="world-social-dock agent-spectator-map">
          <Minimap copy={copy} read_only />
          {party && (
            <PartyFrame
              copy={copy}
              source={{ party, selected: session.selected_character_id, following: false, follow: null, select: null }}
            />
          )}
        </aside>
        {character && (
          <aside className="agent-spectator-portrait" aria-label={character.name}>
            <img
              src={character_icon(character.classe, character.sex, character) ?? undefined}
              alt=""
              decoding="async"
            />
            <strong>{character.name}</strong>
          </aside>
        )}
        {character && !fighting && (
          <div className="agent-spectator-world-vitals">
            <OverworldVitals character={character} read_only />
          </div>
        )}
      </div>
    </>
  )
}
