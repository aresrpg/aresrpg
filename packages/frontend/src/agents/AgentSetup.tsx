// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useState } from 'react'
import { Button, IconButton, NativeModal, ConfirmDialog } from '@aresrpg/ui'
import { CircleAlert, Loader2, Unplug, X } from 'lucide-react'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { env } from '../env.ts'

import { useHostedConnect } from './useHostedConnect.ts'
import { HostedBotPanel } from './HostedBotPanel.tsx'
import { disconnect_agent } from './disconnect_agent.ts'
import { AgentConnectionButton, AgentConnectedModal } from './AgentConnected.tsx'
import { owner_connected } from './owner_state.ts'
import { ProviderHandoff } from './ProviderHandoff.tsx'
import './agent_setup.css'

const AgentProviderSetup = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
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
        <Button className="agent-connect mt-3" onClick={dismiss}>
          {text.agent_cancel}
        </Button>
      </section>
    </NativeModal>
  )
}

const AgentDisconnect = ({
  wallet,
  bot,
  copy,
  close,
}: Readonly<{
  wallet: AuthSession
  bot: HostedBotDescriptor
  copy: AppCopy
  close: () => void
}>) => {
  const [confirm, set_confirm] = useState(false)
  const unfunded = useAppStore(
    ({ session }) =>
      session.sui_balance_mist === 0n &&
      session.agent_inventory.sui_balance_mist === 0n &&
      session.agent_inventory.characters.length + session.agent_inventory.inventory.length > 0
  )
  if (!confirm) return <AgentConnectedModal copy={copy} close={close} disconnect={() => set_confirm(true)} />
  return (
    <ConfirmDialog
      title={copy.ui.agent_disconnect_title}
      icon={<Unplug />}
      description={`${copy.ui.agent_disconnect_body}${unfunded ? ` ${copy.ui.agent_return_needs_sui}` : ''}`}
      confirm_label={copy.ui.agent_disconnect_confirm}
      cancel_label={copy.ui.agent_cancel}
      close_label={copy.wallet_close}
      danger
      on_cancel={close}
      on_confirm={() => {
        void disconnect_agent(wallet, bot, copy)
        close()
      }}
    />
  )
}

export const AgentSetup = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const session = useAppStore((app) => app.session)
  const bot = session.agent_connection.response?.bot
  const authorization = new URLSearchParams(location.search).has('authorization_id')
  if (!authorization && owner_connected(session) && session.wallet && bot)
    return <AgentDisconnect wallet={session.wallet} bot={bot} copy={copy} close={close} />
  return <AgentProviderSetup copy={copy} close={close} />
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
  const wallet = useAppStore((app) => app.session.wallet)
  const bot = useAppStore((app) => app.session.agent_connection.response?.bot)
  const returning = bot?.status === 'returning'
  const busy = useAppStore((app) => app.session.agent_connection.phase === 'returning')
  const activate = () => {
    if (returning && wallet && bot) void disconnect_agent(wallet, bot, copy)
    else set_open(true)
  }
  return (
    <>
      <AgentConnectionButton
        connected={connected}
        class_name={class_name}
        open={activate}
        disabled={busy}
        label={
          connected ? copy.ui.agent_connected : returning ? copy.ui.agent_return_resume : (label ?? copy.ui.agent_setup)
        }
      />
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
