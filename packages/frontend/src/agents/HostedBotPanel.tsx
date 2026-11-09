// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import { Check } from 'lucide-react'
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'
import type { Dispatch } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { env } from '../env.ts'

import { ProviderHandoff } from './ProviderHandoff.tsx'
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
export const HostedBotPanel = ({ copy, provider, state, dispatch }: PanelProps) => {
  const text = copy.ui
  const bot = state.bots.find((row) => row.id === state.selected)
  if (!bot || state.verified !== bot.id) return null
  return (
    <div className="agent-setup-details">
      <p className="flex items-center justify-center gap-2" role="status">
        <Check size={20} aria-hidden="true" />
        {text.agent_hosted_ready}
      </p>
      {state.consent ? (
        <HostedConsent copy={copy} consent={state.consent} bot={bot} dispatch={dispatch} />
      ) : (
        <ProviderHandoff copy={copy} provider={provider} url={new URL('/mcp', env.bot_service_url).href} />
      )}
    </div>
  )
}
