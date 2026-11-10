// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { truncate_address } from '../components/SuiTransferResult.tsx'

import type { AgentKioskController } from './useAgentKiosk.ts'

/** Recovery remains in the inventory. Recall offers and claims together; interrupted transfers retain explicit recovery actions. */
export const AgentKioskCharacters = ({
  kiosk,
  copy,
  disabled,
}: Readonly<{ kiosk: AgentKioskController; copy: AppCopy; disabled: boolean }>) => {
  const player_roster = useAppStore((app) => app.session.characters)
  const { snapshot, wallet } = kiosk
  if (!snapshot || !wallet) return null
  const { recall, characters, roster, pending_characters } = snapshot
  if (![roster.length, pending_characters.length, characters.length].some(Boolean)) return null
  const name = (id: string) =>
    [...player_roster, ...roster].find(({ id: owned }) => owned === id)?.name ?? truncate_address(id)
  return (
    <section className="agent-kiosk__characters" aria-label={copy.ui.agent_transfer_character}>
      <h3>{copy.ui.agent_transfer_character}</h3>
      {roster.map((row) => (
        <div key={row.id}>
          <span title={row.id}>{row.name}</span>
          <Button disabled={disabled || kiosk.blocked} onClick={() => kiosk.recall_character(row)}>
            {copy.ui.agent_withdraw}
          </Button>
        </div>
      ))}
      {pending_characters.map((offer) => (
        <div key={offer.purchase_cap}>
          <span title={offer.character_id}>{name(offer.character_id)}</span>
          <Button disabled={disabled || !snapshot.deposit} onClick={() => kiosk.claim_character(offer)}>
            {copy.ui.agent_claim_character}
          </Button>
          <Button disabled={disabled} onClick={() => kiosk.execute(recall.transfer, { kind: 'cancel', ...offer })}>
            {copy.ui.agent_cancel_handover}
          </Button>
        </div>
      ))}
      {characters.map((offer) => (
        <div key={offer.purchase_cap}>
          <span title={offer.character_id}>{name(offer.character_id)}</span>
          <Button disabled={disabled} onClick={() => kiosk.execute(wallet.agent_transfer, { kind: 'claim', ...offer })}>
            {copy.ui.agent_return_character}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => kiosk.execute(wallet.agent_transfer, { kind: 'cancel', ...offer })}
          >
            {copy.ui.agent_return_cancel}
          </Button>
        </div>
      ))}
    </section>
  )
}
