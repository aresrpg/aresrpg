// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo } from 'react'

import type { AuthSession } from '../auth.ts'
import type { AuthStorage } from '../auth_storage.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { AgentAddressConfirmation } from './AgentAddressConfirmation.tsx'
import { AgentSetupButton } from './AgentSetup.tsx'
import { read_agent_identities } from './pairing_storage.ts'

export const saved_recovery_identities = (wallet: AuthSession | null, storage: AuthStorage | null) => {
  try {
    const request = wallet?.read_agent_pairing_request?.(crypto.randomUUID())
    return request ? read_agent_identities(storage, request) : []
  } catch (error) {
    console.warn('Agent recovery is unavailable for this wallet.', error)
    return []
  }
}

export const AgentKioskIdentity = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore((app) => app.session.wallet)
  const candidate = useAppStore((app) => app.session.agent_pairing_candidate)
  const identities = useMemo(() => saved_recovery_identities(wallet, browser_auth_storage()), [wallet])
  if (candidate) return <AgentAddressConfirmation pairing={candidate} copy={copy} />
  return (
    <div className="agent-kiosk__identity">
      <p>{copy.ui.agent_inventory_connect}</p>
      <AgentSetupButton copy={copy} />
      {!!identities.length && (
        <label>
          {copy.ui.agent_saved_recovery}
          <select
            value=""
            onChange={(event) => {
              const pairing = identities.find(({ address }) => address === event.target.value)
              if (wallet && pairing) dispatch_app({ type: 'agent/pairing_verified', wallet, pairing })
            }}
          >
            <option value="">—</option>
            {identities.map(({ address }) => (
              <option key={address} value={address}>
                {address}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
