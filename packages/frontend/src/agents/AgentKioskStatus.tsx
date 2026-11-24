// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'

import type { AgentKioskController } from './useAgentKiosk.ts'

/** What stops a transfer between the two accounts, and the way to try again. Every transfer surface shows it. */
export const AgentKioskStatus = ({ kiosk, copy }: Readonly<{ kiosk: AgentKioskController; copy: AppCopy }>) => {
  if (!kiosk.pairing) return null
  const failure =
    kiosk.state.error ||
    kiosk.transaction.error ||
    (kiosk.item_recovery_blocked ? copy.ui.agent_transfer_interrupted : null)
  const retry = kiosk.item_recovery_blocked ? kiosk.retry_items : kiosk.state.error ? kiosk.refresh : kiosk.retry
  return (
    <>
      <p className="agent-transfer-error" role="alert" hidden={!failure}>
        {failure}
      </p>
      {/* An outcome the chain has not settled is never offered again: its toast said so. */}
      {failure && !kiosk.transaction.uncertain && (
        <Button disabled={kiosk.busy || kiosk.state.phase === 'loading'} onClick={retry}>
          {copy.ui.agent_hosted_retry}
        </Button>
      )}
    </>
  )
}
