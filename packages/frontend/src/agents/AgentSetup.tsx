// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId, useState, type ReactNode } from 'react'
import { Button, IconButton, NativeModal, ConfirmDialog } from '@aresrpg/ui'
import { CircleAlert, Unplug, X } from 'lucide-react'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { LocationState } from '../modules/location.ts'
import { dispatch_app, useSiteStore } from '../store.ts'
import { env } from '../env.ts'
import { toast } from '../toast.ts'

import { useHostedConnect } from './useHostedConnect.ts'
import { HostedBotPanel } from './HostedBotPanel.tsx'
import { disconnect_agent } from './disconnect_agent.ts'
import { AgentConnectionButton, AgentConnectedModal, AgentStatusButton } from './AgentConnected.tsx'
import { agent_request_id, owner_checkable, without_agent_request, type OwnerAnswer } from './owner_state.ts'
import { ProviderHandoff } from './ProviderHandoff.tsx'
import { useOwnerAnswer } from './useOwnerAnswer.ts'
import './agent_setup.css'

/** Takes the assistant's request out of the address. No owner check runs on a consent link, so the page
 * behind it becomes an ordinary one and asks now, instead of showing a status nobody checked. */
const dismiss_request = (wallet: AuthSession | null, location: LocationState): void => {
  const { pathname, search, hash } = without_agent_request(location)
  dispatch_app({ type: 'location/open', href: `${pathname}${search}${hash}`, replace: true })
  if (owner_checkable(wallet, env.bot_service_url, search)) dispatch_app({ type: 'agent/connection_refresh' })
}

/** An assistant's consent request: its phases, from the review to the bot it connects. */
const AgentConsent = ({ copy, authorization_id }: Readonly<{ copy: AppCopy; authorization_id: string }>) => {
  const wallet = useSiteStore((app) => app.session.wallet)
  const { state, dispatch, eligible } = useHostedConnect(wallet, env.bot_service_url, authorization_id)
  const text = copy.ui
  const connect_action = (
    <Button
      className="agent-connect"
      tone="primary"
      disabled={!eligible}
      busy={state.phase === 'authenticating' || state.phase === 'authorizing'}
      onClick={() => dispatch({ type: 'start', phase: 'authenticating' })}
    >
      {state.phase === 'failed' ? text.agent_hosted_retry : text.agent_guide_continue}
    </Button>
  )
  const review = (
    <section className="agent-consent">
      <p className="agent-consent-notice">{text.agent_hosted_review}</p>
      {connect_action}
    </section>
  )
  const failure_ui = {
    retry: { message: text.agent_hosted_failed, action: connect_action },
    restart: { message: text.agent_hosted_restart, action: null },
  }[state.failure ?? 'retry']
  const content = {
    idle: review,
    authenticating: review,
    authorizing: review,
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
  return <div data-hosted-phase={state.phase}>{content[state.phase]}</div>
}

/** The assistants an owner can connect, then how to add the game to the one picked. */
const AgentProviders = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [provider, select_provider] = useState('')
  return (
    <>
      <div className="agent-provider-cards" role="group" aria-label={copy.ui.agent_choose}>
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
      {env.bot_service_url && (
        <ProviderHandoff copy={copy} provider={provider} url={new URL('/mcp', env.bot_service_url).href} />
      )}
    </>
  )
}

/** Until the owner check answers, the provider cards' own boxes hold their place. */
const AgentChecking = () => (
  <div className="agent-provider-cards" aria-hidden="true">
    {[0, 1, 2].map((index) => (
      <span key={index} className="aui-skeleton agent-provider-wait" />
    ))}
  </div>
)

/** The owner check has no answer: nothing is known about the agent, so the only offer is to ask again. */
const AgentUnreachable = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <section className="agent-consent">
    <p role="alert">{copy.ui.agent_unreachable_body}</p>
    <Button tone="primary" className="agent-connect" onClick={() => dispatch_app({ type: 'agent/connection_refresh' })}>
      {copy.ui.agent_hosted_retry}
    </Button>
  </section>
)

/** What the owner check answered: its title and what it offers. Only a real "not connected" offers a
 * setup; a connected account has nothing to set up, and its frames show it elsewhere. */
const answer_view = (copy: AppCopy, answer: OwnerAnswer): Readonly<{ title: string; body: ReactNode }> =>
  ({
    unknown: { title: copy.ui.agent_checking, body: <AgentChecking /> },
    unreachable: { title: copy.ui.agent_unreachable_title, body: <AgentUnreachable copy={copy} /> },
    not_connected: { title: copy.ui.agent_choose, body: <AgentProviders copy={copy} /> },
    connected: { title: copy.ui.agent_connected, body: null },
  })[answer]

/**
 * The setup of an account's agent: an assistant's consent request whatever the account's agent is, else
 * what the owner check answered. The AI page lays it in place; the game's dialog frames it. `close`
 * is the frame's way out; Cancel also takes an assistant's request out of the address.
 */
export const AgentSetupBody = ({
  copy,
  title_id,
  close,
}: Readonly<{ copy: AppCopy; title_id: string; close?: () => void }>) => {
  const wallet = useSiteStore((app) => app.session.wallet)
  const location = useSiteStore((app) => app.location)
  const answer = useOwnerAnswer()
  const authorization_id = agent_request_id(location.search)
  const { title, body } = authorization_id
    ? {
        title: copy.ui.agent_hosted_consent,
        body: <AgentConsent key={authorization_id} copy={copy} authorization_id={authorization_id} />,
      }
    : answer_view(copy, answer)
  const cancel = authorization_id
    ? () => {
        dismiss_request(wallet, location)
        close?.()
      }
    : close
  return (
    <>
      <h2 id={title_id}>{title}</h2>
      {body}
      {cancel && (
        <Button className="agent-connect mt-3" onClick={cancel}>
          {copy.ui.agent_cancel}
        </Button>
      )}
    </>
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
  const unfunded = useSiteStore(
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

/** The game's setup dialog: the setup body in a dialog frame, or the connected agent's own dialog. */
export const AgentSetup = ({ copy, close }: Readonly<{ copy: AppCopy; close: () => void }>) => {
  const title_id = useId()
  const wallet = useSiteStore((app) => app.session.wallet)
  const bot = useSiteStore((app) => app.session.agent_connection.response?.bot)
  const requested = useSiteStore((app) => agent_request_id(app.location.search) !== null)
  const answer = useOwnerAnswer()
  if (!requested && answer === 'connected' && wallet && bot)
    return <AgentDisconnect wallet={wallet} bot={bot} copy={copy} close={close} />
  return (
    <NativeModal close={close} label={copy.ui.agent_setup} aria-labelledby={title_id} className="aui-modal-scrim">
      <section className="agent-setup" data-agent-setup="">
        <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={close} />
        <AgentSetupBody copy={copy} title_id={title_id} close={close} />
      </section>
    </NativeModal>
  )
}

/** What the button reads for each answer of the owner check. Only a real "not connected" reads as a
 * setup to start (`setup`); a check without an answer never does. */
const ANSWER_LABEL: Readonly<Record<OwnerAnswer, (copy: AppCopy, setup: string) => string>> = {
  connected: (copy) => copy.ui.agent_connected,
  unknown: (copy) => copy.ui.agent_checking,
  unreachable: (copy) => copy.ui.agent_unreachable,
  not_connected: (_copy, setup) => setup,
}
/** Each answer's dot, in the site status card's tones: a check without an answer stays neutral. */
const ANSWER_TONE: Readonly<Record<OwnerAnswer, string>> = {
  connected: 'bg-success',
  unknown: 'bg-steel',
  unreachable: 'bg-danger',
  not_connected: 'bg-steel',
}

/** The agent's one control: what the owner check answered, and the way on (the setup, the connected agent's dialog, a
 * new check). `face` picks its look: the approved seal, or the quiet status a row of other controls carries. */
export const AgentSetupButton = ({
  copy,
  label,
  class_name,
  face = 'seal',
}: Readonly<{
  copy: AppCopy
  label?: string
  class_name?: string
  face?: 'seal' | 'status'
}>) => {
  const [open, set_open] = useState(false)
  const answer = useOwnerAnswer()
  const connected = answer === 'connected'
  const wallet = useSiteStore((app) => app.session.wallet)
  const connection = useSiteStore((app) => app.session.agent_connection)
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
  const label_of = (shown: OwnerAnswer): string => ANSWER_LABEL[shown](copy, status_label ?? copy.ui.agent_setup)
  return (
    <>
      {face === 'status' ? (
        <AgentStatusButton
          tone={ANSWER_TONE[answer]}
          label={label_of(answer)}
          labels={Object.keys(ANSWER_TONE).map((shown) => label_of(shown as OwnerAnswer))}
          open={activate}
          disabled={busy}
        />
      ) : (
        <AgentConnectionButton
          connected={connected}
          class_name={class_name}
          open={activate}
          disabled={busy}
          label={label_of(answer)}
        />
      )}
      {open && <AgentSetup copy={copy} close={() => set_open(false)} />}
    </>
  )
}
