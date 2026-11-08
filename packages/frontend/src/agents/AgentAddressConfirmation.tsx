// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-recall'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import './agent_address.css'

/** Public proof discovers an identity; only this explicit comparison selects a transfer target. */
export const AgentAddressConfirmation = ({
  pairing,
  copy,
}: Readonly<{ pairing: AgentPairingIdentity; copy: AppCopy }>) => {
  const wallet = useAppStore((app) => app.session.wallet)
  const confirmed = useAppStore((app) => app.session.inventory_pairing?.address === pairing.address)
  if (!wallet) return null
  const change = (checked: boolean) => {
    if (!checked) return dispatch_app({ type: 'agent/inventory_target', wallet, pairing: null })
    try {
      owner_agent_identity(pairing, wallet.read_agent_pairing_request?.(crypto.randomUUID()))
      dispatch_app({ type: 'agent/inventory_target', wallet, pairing })
    } catch {
      toast.add(copy.ui.agent_verify_mismatch, 'info')
    }
  }
  return (
    <section className="agent-address-confirmation">
      <output className="agent-address-confirmation__address">{pairing.address}</output>
      <label>
        <input type="checkbox" checked={confirmed} onChange={(event) => change(event.target.checked)} />
        <span>{copy.ui.agent_verify_address}</span>
      </label>
    </section>
  )
}
