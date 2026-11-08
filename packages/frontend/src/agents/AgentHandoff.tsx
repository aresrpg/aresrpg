// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useReducer } from 'react'
import { Button } from '@aresrpg/ui'

import { copy_text, type AppCopy } from '../i18n/copy.ts'

type CopyStatus = 'idle' | 'copied' | 'failed'

export const agent_guide_url = () => new URL('/agents/client.txt', globalThis.location.origin).href

/** Copying public instructions is the only supported handoff; it grants no account authority. */
export const AgentHandoff = ({ copy, provider }: Readonly<{ copy: AppCopy; provider: string | null }>) => {
  const text = copy_text(copy.ui)
  const request = text('agent_handoff_request', {
    provider: provider ?? '',
    url: agent_guide_url(),
  })
  return <AgentPrompt copy={copy} request={request} disabled={!provider} />
}

export const AgentPrompt = ({
  copy,
  request,
  disabled = false,
  hint,
}: Readonly<{ copy: AppCopy; request: string; disabled?: boolean; hint?: string }>) => {
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
        <p hidden={disabled}>{hint ?? text('agent_paste_request')}</p>
        <pre hidden={disabled} aria-label={text('agent_copy_request')} className="agent-prompt" tabIndex={0}>
          {request}
        </pre>
        <Button tone="primary" className="agent-connect" disabled={disabled} onClick={() => void copy_request()}>
          {text('agent_copy_request')}
        </Button>
        <p role="status" className={status === 'copied' ? 'sr-only' : undefined} hidden={status === 'idle'}>
          {status === 'failed' ? text('agent_copy_failed') : copy_text(copy.wallet_send_shared)('copied')}
        </p>
      </div>
    </>
  )
}
