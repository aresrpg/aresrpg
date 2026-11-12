// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Bot } from 'lucide-react'

import { WalletCard, WalletBalanceBox } from '../components/WalletCard.tsx'
import { WorldStatus } from '../components/WorldStatus.tsx'
import { PartyFrame } from '../components/PartyFrame.tsx'
import { selected_party } from '../modules/party.ts'
import { Minimap } from '../game/hud/Minimap.tsx'
import { CompassStrip } from '../game/hud/CompassStrip.tsx'
import { OverworldVitals } from '../game/hud/OverworldVitals.tsx'
import { PlayerCharacterTabs } from '../components/PlayerCharacterTabs.tsx'
import { character_icon } from '../content/assets.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import type { SessionState } from '../modules/session.ts'

import { displayed_character } from './observation.ts'
import { AgentActivity } from './AgentActivity.tsx'
import './spectator.css'

export const AgentSpectator = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const party = useAppStore(selected_party)
  const fighting = useAppStore((state) => state.fight.mounted)
  const character = displayed_character(session)
  return (
    <>
      <div className="agent-spectator" data-agent-spectator="">
        <WorldStatus copy={copy} party_available={false}>
          <PlayerCharacterTabs copy={copy} create_character={null} />
        </WorldStatus>
        <CompassStrip copy={copy} />
        <AgentActivity copy={copy} />
        <aside className="world-social-dock agent-spectator-map">
          <div className="world-account">
            <AgentWalletBalance copy={copy} session={session} />
            <WalletCard
              key={session.wallet?.address}
              copy={copy}
              session={session}
              disconnect={() => dispatch_app({ type: 'auth/disconnected' })}
            />
          </div>
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

export const AgentWalletBalance = ({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) => {
  const pairing = session.agent_view.request?.pairing
  if (!pairing) return null
  const balance =
    pairing.address === session.inventory_pairing?.address && session.link_status === 'ready'
      ? session.agent_inventory.sui_balance_mist
      : null
  return (
    <WalletBalanceBox
      label={copy.ui.agent_wallet}
      sui_balance_mist={balance}
      icon={<Bot size={14} aria-hidden="true" />}
    />
  )
}
