// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import { Loader2 } from 'lucide-react'

import { dispatch_app, useAppStore } from '../store.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { AgentSetupButton } from './AgentSetup.tsx'

export const AgentKioskIdentity = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const connection = useAppStore((app) => app.session.agent_connection)
  if (connection.phase === 'checking' && !connection.response)
    return (
      <div className="agent-kiosk__identity">
        <span role="status" aria-label={copy.ui.agent_hosted_pending}>
          <Loader2 size={20} className="animate-spin" />
        </span>
        <Button onClick={() => dispatch_app({ type: 'agent/connection_cancel' })}>{copy.ui.agent_cancel}</Button>
      </div>
    )
  if (connection.response?.status === 'ambiguous') return <p role="alert">{copy.ui.agent_hosted_ambiguous}</p>
  if (connection.phase === 'failed')
    return (
      <Button onClick={() => dispatch_app({ type: 'agent/connection_refresh' })}>{copy.ui.agent_hosted_retry}</Button>
    )
  if (connection.response?.status === 'connected') return <p role="status">{copy.ui.agent_connected}</p>
  return <AgentSetupButton copy={copy} label={copy.ui.agent_connect_your} />
}
