// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'
import type { Dispatch } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { env } from '../env.ts'

import { AgentPrompt } from './AgentHandoff.tsx'
import type { HostedInput, HostedState } from './hosted_state.ts'

type PanelProps = Readonly<{
  copy: AppCopy
  provider: string
  state: HostedState<HostedBotDescriptor>
  dispatch: Dispatch<HostedInput<HostedBotDescriptor>>
}>
const HostedConsent = ({
  copy,
  consent,
  bot,
  dispatch,
}: Readonly<{
  copy: AppCopy
  consent: HostedConnectRequest
  bot: HostedBotDescriptor
  dispatch: Dispatch<HostedInput<HostedBotDescriptor>>
}>) => {
  const text = copy.ui
  return (
    <section>
      <h3>{text.agent_hosted_consent}</h3>
      <p>{consent.client_name}</p>
      {consent.scopes.includes('bot:play') && <p>{text.agent_hosted_authority}</p>}
      <p className="break-all">{consent.client_id}</p>
      <p className="break-all">{consent.redirect_uri}</p>
      <p className="break-all">{consent.resource}</p>
      <p>
        {consent.network} · {text.agent_hosted_policy} {bot.policy_revision}
      </p>
      <ul>
        {consent.scopes.map((scope) => (
          <li key={scope}>{scope}</li>
        ))}
      </ul>
      <Button
        className="agent-connect"
        tone="primary"
        onClick={() => dispatch({ type: 'start', phase: 'authorizing' })}
      >
        {text.agent_hosted_approve}
      </Button>
    </section>
  )
}
const SelectedBot = ({ copy, provider, state, dispatch, bot }: PanelProps & Readonly<{ bot: HostedBotDescriptor }>) => {
  const text = copy.ui
  return (
    <>
      <p className="break-all">{bot.address}</p>
      {state.verified !== bot.id ? (
        <Button className="agent-connect" onClick={() => dispatch({ type: 'start', phase: 'verifying' })}>
          {text.agent_hosted_verify}
        </Button>
      ) : (
        <>
          <p role="status">{text.agent_hosted_ready}</p>
          <p>{text.agent_hosted_waiting}</p>
          {state.consent ? (
            <HostedConsent copy={copy} consent={state.consent} bot={bot} dispatch={dispatch} />
          ) : (
            <>
              <p>{text[`agent_hosted_${provider.toLowerCase()}`]}</p>
              <AgentPrompt
                copy={copy}
                request={new URL('/mcp', env.bot_service_url).href}
                hint={text.agent_hosted_endpoint}
              />
            </>
          )}
        </>
      )}
    </>
  )
}
export const HostedBotPanel = (props: PanelProps) => {
  const { copy, state, dispatch } = props
  const text = copy.ui
  const selected = state.bots.find((bot) => bot.id === state.selected)
  return (
    <div className="agent-setup-details">
      {state.bots.length === 0 ? (
        <Button className="agent-connect" onClick={() => dispatch({ type: 'start', phase: 'creating' })}>
          {text.agent_hosted_create}
        </Button>
      ) : (
        <label>
          {text.agent_hosted_bot}
          <select
            className="w-full"
            value={state.selected}
            onChange={(event) => dispatch({ type: 'edit', values: { selected: event.target.value, verified: '' } })}
          >
            <option value="">{text.agent_hosted_select}</option>
            {state.bots.map((bot) => (
              <option key={bot.id} value={bot.id} disabled={bot.status !== 'ready'}>
                {bot.address}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && <SelectedBot {...props} bot={selected} />}
    </div>
  )
}
