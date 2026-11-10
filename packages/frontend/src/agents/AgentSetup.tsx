// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useState } from 'react'
import { Button, IconButton, NativeModal } from '@aresrpg/ui'
import { Bot, CircleAlert, Loader2, X } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { env } from '../env.ts'

import { useHostedConnect } from './useHostedConnect.ts'
import { HostedBotPanel } from './HostedBotPanel.tsx'
import { owner_connected } from './owner_state.ts'
import { AgentRecovery } from './AgentRecovery.tsx'
import { ProviderHandoff } from './ProviderHandoff.tsx'
import './agent_setup.css'

export const AgentSetup = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const title_id = useId()
  const wallet = useAppStore((app) => app.session.wallet)
  const [provider, select_provider] = useState('')
  const [authorization_id] = useState(() => new URLSearchParams(location.search).get('authorization_id'))
  const { state, dispatch, eligible } = useHostedConnect(wallet, env.bot_service_url, authorization_id)
  const text = copy.ui
  const authorization_request = authorization_id !== null
  const title = text[authorization_request ? 'agent_hosted_consent' : 'agent_choose']
  const dismiss = () => {
    const url = new URL(location.href)
    url.searchParams.delete('authorization_id')
    history.replaceState(history.state, '', url)
    close()
  }
  const connect_action = (
    <Button
      className="agent-connect"
      tone="primary"
      disabled={!eligible}
      onClick={() => dispatch({ type: 'start', phase: 'authenticating' })}
    >
      {state.phase === 'failed' ? text.agent_hosted_retry : text.agent_pair_connect}
    </Button>
  )
  const waiting = (
    <div className="flex justify-center py-8" role="status" aria-label={text.agent_hosted_pending} aria-busy="true">
      <Loader2 className="animate-spin text-gold opacity-80" size={28} aria-hidden="true" />
    </div>
  )
  const failure_ui = {
    retry: { message: text.agent_hosted_failed, action: connect_action },
    restart: { message: text.agent_hosted_restart, action: null },
  }[state.failure ?? 'retry']
  const content = {
    idle: null,
    authenticating: waiting,
    authorizing: waiting,
    ready: <HostedBotPanel copy={copy} state={state} dispatch={dispatch} />,
    failed: (
      <>
        <div className="agent-connect-error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p>{failure_ui.message}</p>
        </div>
        {failure_ui.action}
      </>
    ),
    complete: null,
  }
  return (
    <NativeModal close={dismiss} label={title} aria-labelledby={title_id} className="aui-modal-scrim">
      <section className="agent-setup" data-agent-setup="" data-hosted-phase={state.phase}>
        <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={dismiss} />
        <h2 id={title_id}>{title}</h2>
        {!authorization_request && (
          <div className="agent-provider-cards" role="group" aria-label={title}>
            {['ChatGPT', 'Claude', 'Grok'].map((name) => (
              <button
                key={name}
                type="button"
                className="agent-provider-card"
                aria-pressed={provider === name}
                onClick={() => select_provider(name)}
              >
                <img src={`/providers/${name.toLowerCase()}.svg`} alt="" style={{ colorScheme: 'dark' }} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}
        {authorization_request
          ? content[state.phase]
          : env.bot_service_url && (
              <ProviderHandoff copy={copy} provider={provider} url={new URL('/mcp', env.bot_service_url).href} />
            )}
        {!authorization_request && <AgentRecovery copy={copy} mode="setup" />}
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
  const connected = useAppStore((app) => owner_connected(app.session))
  return (
    <>
      <Button className={class_name} onClick={() => set_open(true)} data-agent-setup-button="">
        <Bot size={16} />
        {connected ? copy.ui.agent_connected : (label ?? copy.ui.agent_setup)}
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
