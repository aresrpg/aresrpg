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
      <Button tone="primary" className="agent-connect" disabled={disabled} onClick={() => void copy_request()}>
        {text('agent_copy_request')}
      </Button>
      <div hidden={disabled} className="agent-setup-details">
        <p>{hint ?? text('agent_paste_request')}</p>
        <textarea
          aria-label={text('agent_copy_request')}
          readOnly
          value={request}
          rows={4}
          className="w-full resize-y rounded border border-white/15 bg-black/20 p-2 text-xs text-text"
        />
        <p role="status" hidden={status === 'idle'}>
          {status === 'failed' ? text('agent_copy_failed') : copy_text(copy.wallet_send_shared)('copied')}
        </p>
      </div>
    </>
  )
}
