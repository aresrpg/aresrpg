// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { truncate_address } from '../components/SuiTransferResult.tsx'

import type { AgentKioskController } from './useAgentKiosk.ts'

/** Recovery remains in the inventory. Every offer, claim and cancellation is a separate gesture. */
export const AgentKioskCharacters = ({
  kiosk,
  copy,
  disabled,
}: Readonly<{ kiosk: AgentKioskController; copy: AppCopy; disabled: boolean }>) => {
  const roster = useAppStore((app) => app.session.characters)
  const { snapshot, wallet } = kiosk
  if (!snapshot || !wallet) return null
  const { recall, characters } = snapshot
  if (![recall.characters.length, recall.pending.length, characters.length, snapshot.character_error].some(Boolean))
    return null
  const name = (id: string) => roster.find(({ id: owned }) => owned === id)?.name ?? truncate_address(id)
  return (
    <details className="agent-kiosk__characters">
      <summary>{copy.ui.agent_transfer_character}</summary>
      {snapshot.character_error && (
        <p className="agent-transfer-error" role="alert">
          {snapshot.character_error}
        </p>
      )}
      {recall.characters.map((row) => (
        <div key={row.character_id}>
          <span title={row.character_id}>{name(row.character_id)}</span>
          <Button
            disabled={disabled}
            onClick={() => kiosk.execute(recall.transfer, { kind: 'offer', ...row, recipient: wallet.address })}
          >
            {copy.ui.agent_withdraw}
          </Button>
        </div>
      ))}
      {recall.pending.map((offer) => (
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
    </details>
  )
}
