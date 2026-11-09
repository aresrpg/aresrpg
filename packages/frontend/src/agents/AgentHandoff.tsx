// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useReducer, type ReactNode } from 'react'
import { Button } from '@aresrpg/ui'

import { copy_text, type AppCopy } from '../i18n/copy.ts'

type CopyStatus = 'idle' | 'copied' | 'failed'

export const AgentPrompt = ({
  copy,
  request,
  children,
}: Readonly<{ copy: AppCopy; request: string; children?: ReactNode }>) => {
  const [status, report] = useReducer((_state: CopyStatus, next: CopyStatus) => next, 'idle')
  const text = copy_text(copy.ui)
  const copy_request = async () => {
    try {
      await navigator.clipboard.writeText(request)
      report('copied')
    } catch {
      console.error('Agent setup request could not be copied.')
      report('failed')
    }
  }
  return (
    <>
      <div className="agent-setup-details">
        {children || (
          <pre aria-label={text('agent_copy_request')} className="agent-prompt" tabIndex={0}>
            {request}
          </pre>
        )}
        <Button tone="primary" className="agent-connect" onClick={() => void copy_request()}>
          {text('agent_copy_request')}
        </Button>
        <p role="status" className={status === 'copied' ? 'sr-only' : undefined} hidden={status === 'idle'}>
          {status === 'failed' ? text('agent_copy_failed') : copy_text(copy.wallet_send_shared)('copied')}
        </p>
      </div>
    </>
  )
}
