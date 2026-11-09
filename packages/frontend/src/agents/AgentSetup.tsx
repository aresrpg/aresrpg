// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useState } from 'react'
import { Button, IconButton, NativeModal } from '@aresrpg/ui'
import { Bot, Loader2, X } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { env } from '../env.ts'

import { useHostedConnect } from './useHostedConnect.ts'
import { HostedBotPanel } from './HostedBotPanel.tsx'
import './agent_setup.css'

export const AgentSetup = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const title_id = useId()
  const wallet = useAppStore((app) => app.session.wallet)
  const [provider, select_provider] = useState('')
  const [authorization_id] = useState(() => new URLSearchParams(location.search).get('authorization_id'))
  const { state, dispatch } = useHostedConnect(wallet, env.bot_service_url, authorization_id)
  const text = copy.ui
  const pending = ['authenticating', 'authorizing'].includes(state.phase)
  const eligible = [wallet?.identity === 'zklogin', !!env.bot_service_url].every(Boolean)
  const dismiss = () => {
    const url = new URL(location.href)
    url.searchParams.delete('authorization_id')
    history.replaceState(history.state, '', url)
    close()
  }
  return (
    <NativeModal close={dismiss} label={text.agent_choose} aria-labelledby={title_id} className="aui-modal-scrim">
      <section className="agent-setup" data-agent-setup="" data-hosted-phase={state.phase}>
        <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={dismiss} />
        <h2 id={title_id}>{text.agent_choose}</h2>
        <div className="agent-provider-cards" role="group" aria-label={text.agent_choose}>
          {['ChatGPT', 'Claude', 'Grok'].map((name) => (
            <button
              key={name}
              type="button"
              className="agent-provider-card"
              aria-pressed={provider === name}
              disabled={pending}
              onClick={() => select_provider(name)}
            >
              <img src={`/providers/${name.toLowerCase()}.svg`} alt="" style={{ colorScheme: 'dark' }} />
              <span>{name}</span>
            </button>
          ))}
        </div>
        {state.phase === 'failed' && <p role="alert">{text.agent_hosted_failed}</p>}
        {pending && (
          <div
            className="flex justify-center py-8"
            role="status"
            aria-label={text.agent_hosted_pending}
            aria-busy="true"
          >
            <Loader2 className="animate-spin text-gold opacity-80" size={28} aria-hidden="true" />
          </div>
        )}
        {['idle', 'failed'].includes(state.phase) && (
          <Button
            className="agent-connect"
            tone="primary"
            disabled={!eligible || !provider}
            onClick={() => dispatch({ type: 'start', phase: 'authenticating' })}
          >
            {text.agent_pair_connect}
          </Button>
        )}
        {state.phase === 'ready' && (
          <HostedBotPanel copy={copy} provider={provider} state={state} dispatch={dispatch} />
        )}
        <Button className="agent-connect mt-3" onClick={dismiss}>
          {text.agent_cancel}
        </Button>
      </section>
    </NativeModal>
  )
}

export const AgentSetupButton = ({
  copy,
  label,
  class_name,
}: Readonly<{
  copy: AppCopy
  label?: string
  class_name?: string
}>) => {
  const [open, set_open] = useState(false)
  return (
    <>
      <Button className={class_name} onClick={() => set_open(true)} data-agent-setup-button="">
        <Bot size={16} />
        {label ?? copy.ui.agent_setup}
      </Button>
      {open && <AgentSetup copy={copy} close={() => set_open(false)} />}
    </>
  )
}

/** Route entry uses the same modal, with the ordinary login boundary owned by PlayerRuntime. */
export const AgentSetupDialog = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const dialog = useAppStore((state) => state.navigation.dialog)
  if (!session.wallet || dialog !== 'agent_setup') return null
  return (
    <AgentSetup
      copy={copy}
      close={() =>
        dispatch_app({
          type: 'dialog/open',
          dialog: session.roster_loaded && session.characters.length === 0 ? 'welcome' : null,
        })
      }
    />
  )
}
