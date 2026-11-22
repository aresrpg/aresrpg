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
import { toast } from '../toast.ts'

import { useHostedConnect } from './useHostedConnect.ts'
import { HostedBotPanel } from './HostedBotPanel.tsx'
import { disconnect_agent } from './disconnect_agent.ts'
import { AgentConnectionButton, AgentConnectedModal } from './AgentConnected.tsx'
import { agent_tab_source } from './character_tabs.ts'
import { owner_checkable, type OwnerAnswer } from './owner_state.ts'
import { ProviderHandoff } from './ProviderHandoff.tsx'
import { useOwnerAnswer } from './useOwnerAnswer.ts'
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
    // No owner check runs on a consent link. Once the request is dismissed the page behind is an
    // ordinary one: ask now, so it does not keep showing a status nobody checked.
    if (authorization_request && owner_checkable(wallet, env.bot_service_url, url.search))
      dispatch_app({ type: 'agent/connection_refresh' })
    close()
  }
  const connect_action = (
    <Button
      className="agent-connect"
      tone="primary"
      disabled={!eligible}
      onClick={() => dispatch({ type: 'start', phase: 'authenticating' })}
    >
      {state.phase === 'failed' ? text.agent_hosted_retry : text.agent_guide_continue}
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
    idle: (
      <section className="agent-consent">
        <p className="agent-consent-notice">{text.agent_hosted_review}</p>
        {connect_action}
      </section>
    ),
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

/** The owner check has not answered: the dialog says so and offers neither setup nor disconnect yet. */
const AgentChecking = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const title_id = useId()
  return (
    <NativeModal close={close} label={copy.ui.agent_checking} aria-labelledby={title_id} className="aui-modal-scrim">
      <section className="agent-setup" data-agent-setup="" data-agent-checking="">
        <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={close} />
        <h2 id={title_id}>{copy.ui.agent_checking}</h2>
        <div className="flex justify-center py-8" role="status" aria-label={copy.ui.agent_checking} aria-busy="true">
          <Loader2 className="animate-spin text-gold opacity-80" size={28} aria-hidden="true" />
        </div>
      </section>
    </NativeModal>
  )
}

/** The owner check has no answer: the dialog says so, and offers only to ask again. */
const AgentUnreachable = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const title_id = useId()
  return (
    <NativeModal
      close={close}
      label={copy.ui.agent_unreachable_title}
      aria-labelledby={title_id}
      className="aui-modal-scrim"
    >
      <section className="agent-setup" data-agent-setup="" data-agent-unreachable="">
        <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={close} />
        <h2 id={title_id}>{copy.ui.agent_unreachable_title}</h2>
        <p role="alert">{copy.ui.agent_unreachable_body}</p>
        <Button
          tone="primary"
          onClick={() => {
            // The dialog closes with the retry: its answer shows on the button, not in a second dialog.
            dispatch_app({ type: 'agent/connection_refresh' })
            close()
          }}
        >
          {copy.ui.agent_hosted_retry}
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
  const answer = useOwnerAnswer()
  const bot = session.agent_connection.response?.bot
  const authorization = new URLSearchParams(location.search).has('authorization_id')
  // A consent link shows its request whatever this account's agent is; it is never held by the owner check.
  if (authorization) return <AgentProviderSetup copy={copy} close={close} />
  if (answer === 'unknown') return <AgentChecking copy={copy} close={close} />
  // Nothing is known about this account's agent: no setup is offered over an agent that may exist.
  if (answer === 'unreachable') return <AgentUnreachable copy={copy} close={close} />
  if (answer === 'connected' && session.wallet && bot)
    return <AgentDisconnect wallet={session.wallet} bot={bot} copy={copy} close={close} />
  return <AgentProviderSetup copy={copy} close={close} />
}

/** What the button reads for each answer of the owner check. Only a real "not connected" reads as a
 * setup to start (`setup`); a check without an answer never does. */
const ANSWER_LABEL: Readonly<Record<OwnerAnswer, (copy: AppCopy, setup: string) => string>> = {
  connected: (copy) => copy.ui.agent_connected,
  unknown: (copy) => copy.ui.agent_checking,
  unreachable: (copy) => copy.ui.agent_unreachable,
  not_connected: (_copy, setup) => setup,
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
  const answer = useOwnerAnswer()
  const connected = answer === 'connected'
  const wallet = useAppStore((app) => app.session.wallet)
  const connection = useAppStore((app) => app.session.agent_connection)
  const bot = connection.response?.bot
  const returning = bot?.status === 'returning'
  const { phase } = connection
  const checking = phase === 'checking' && !connection.response
  const busy = phase === 'returning'
  const status_label = {
    // A check that has no answer yet is named below; a re-check keeps the label of the answer it has.
    checking: label,
    returning: copy.ui.agent_return_resume,
    failed: copy.ui.agent_hosted_retry,
    unavailable: copy.ui.agent_hosted_retry,
    idle: label,
    ready: label,
  }[returning ? 'returning' : phase]
  const activate = () => {
    if (checking) return dispatch_app({ type: 'agent/connection_cancel' })
    if (connection.response?.status === 'ambiguous') return toast.add(copy.ui.agent_hosted_ambiguous, 'error')
    if (returning && wallet && bot) void disconnect_agent(wallet, bot, copy)
    else if (['failed', 'unavailable'].includes(phase)) dispatch_app({ type: 'agent/connection_refresh' })
    else set_open(true)
  }
  return (
    <>
      <AgentConnectionButton
        connected={connected}
        class_name={class_name}
        open={activate}
        disabled={busy}
        label={ANSWER_LABEL[answer](copy, status_label ?? copy.ui.agent_setup)}
      />
      {open && <AgentSetup copy={copy} close={() => set_open(false)} />}
    </>
  )
}
