// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { AgentPairingRequest } from '@aresrpg/sdk/agent-pairing'

import type { AppCopy } from '../i18n/copy.ts'
import { browser_auth_storage } from '../auth_storage.ts'

import { read_agent_identities } from './pairing_storage.ts'
import { AgentTransferPreview } from './AgentTransferPreview.tsx'

export const AgentSavedPairings = ({
  request,
  exclude,
  copy,
}: Readonly<{
  request: AgentPairingRequest
  exclude?: string
  copy: AppCopy
}>) => {
  const [identities] = useState(() => read_agent_identities(browser_auth_storage(), request))
  return (
    <div className="space-y-3">
      {identities
        .filter((row) => row.address !== exclude)
        .map((pairing) => (
          <section key={pairing.address}>
            <h3>{copy.ui.agent_saved_recovery}</h3>
            <output className="block break-all">{pairing.address}</output>
            <AgentTransferPreview pairing={pairing} copy={copy} recovery_only />
          </section>
        ))}
    </div>
  )
}
