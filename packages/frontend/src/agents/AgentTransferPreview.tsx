// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { useState } from 'react'
import { owner_agent_identity } from '@aresrpg/sdk/agent-recall'
import { Button } from '@aresrpg/ui'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { toast } from '../toast.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { AgentRecallPanel } from './AgentRecallPanel.tsx'
import { AgentReturnInbox } from './AgentReturnInbox.tsx'
import { AgentTransferReview } from './AgentTransferReview.tsx'

/** Select explicitly from the current owned roster; no first-character default. */
export const AgentTransferPreview = ({
  pairing,
  copy,
  recovery_only = false,
}: Readonly<{ pairing: AgentPairingIdentity; copy: AppCopy; recovery_only?: boolean }>) => {
  const { address } = pairing
  const wallet = useAppStore((app) => app.session.wallet)
  const confirmed_address = useAppStore((app) => app.session.inventory_pairing?.address)
  if (!wallet) return null
  return (
    <div className="space-y-2">
      {wallet.read_agent_pairing_request && (
        <Button
          onClick={() => {
            const request = wallet.read_agent_pairing_request?.(crypto.randomUUID())
            if (request)
              dispatch_app({
                type: 'agent/watch',
                observation: { pairing, public_identifier: request.zklogin_public_identifier, character_id: null },
              })
          }}
        >
          {copy.ui.agent_watch}
        </Button>
      )}
      <label className="block">
        <input
          type="checkbox"
          checked={confirmed_address === address}
          onChange={(event) => {
            try {
              const request = wallet.read_agent_pairing_request?.(crypto.randomUUID())
              owner_agent_identity(pairing, request)
              dispatch_app({ type: 'agent/inventory_target', wallet, pairing: event.target.checked ? pairing : null })
            } catch {
              toast.add(copy.ui.agent_verify_mismatch, 'info')
            }
          }}
        />
        {copy.ui.agent_verify_address}
      </label>
      <p>{copy.ui.agent_verify_mismatch}</p>
      {confirmed_address === address && (
        <AgentCustodyPanel
          key={JSON.stringify([wallet.address, address])}
          wallet={wallet}
          pairing={pairing}
          copy={copy}
          recovery_only={recovery_only}
        />
      )}
    </div>
  )
}

const AgentCustodyPanel = ({
  wallet,
  pairing,
  copy,
  recovery_only,
}: Readonly<{
  wallet: AuthSession
  pairing: AgentPairingIdentity
  copy: AppCopy
  recovery_only: boolean
}>) => {
  const { address } = pairing
  const persistent = pairing.signer_mode === 'host-persistent'
  const characters = useAppStore((app) => app.session.characters)
  const [selected, select] = useState('')
  const character = characters.find((row) => row.id === selected)
  const eligible = character && character.custody !== 'fight' && character.equipment.length === 0
  return (
    <div className="space-y-2">
      <AgentRecallPanel wallet={wallet} pairing={pairing} copy={copy} />
      <AgentReturnInbox wallet={wallet} address={address} copy={copy} />
      {!recovery_only && (
        <>
          <label className="block">
            {copy.ui.agent_transfer_character}
            <select
              className="block w-full bg-black text-white"
              value={selected}
              onChange={(event) => select(event.target.value)}
            >
              <option value="">—</option>
              {characters.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {character && !eligible && <p>{copy.ui.agent_transfer_unavailable}</p>}
          {eligible && (
            <AgentTransferReview
              key={JSON.stringify([wallet.address, address, character])}
              wallet={wallet}
              copy={copy}
              allow_submit={persistent}
              intent={{ kind: 'offer', character_id: character.id, kiosk: character.kiosk, recipient: address }}
            />
          )}
        </>
      )}
    </div>
  )
}
