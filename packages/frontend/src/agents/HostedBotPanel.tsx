// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'
import type { Dispatch } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

import { hosted_consent_destination } from './hosted_challenge.ts'
import type { HostedInput, HostedState } from './hosted_state.ts'

type PanelProps = Readonly<{
  copy: AppCopy
  state: HostedState<HostedBotDescriptor>
  dispatch: Dispatch<HostedInput<HostedBotDescriptor>>
}>
const HostedConsent = ({
  copy,
  consent,
  dispatch,
}: Readonly<{
  copy: AppCopy
  consent: HostedConnectRequest
  dispatch: Dispatch<HostedInput<HostedBotDescriptor>>
}>) => {
  const text = copy.ui
  return (
    <section className="agent-consent">
      <p className="agent-consent-destination">{hosted_consent_destination(consent.redirect_uri)}</p>
      <p className="agent-consent-notice">
        {consent.scopes.includes('bot:play')
          ? text.agent_hosted_authority
          : consent.scopes.includes('bot:pause')
            ? text.agent_hosted_pause_access
            : text.agent_hosted_read_access}
      </p>
      <Button
        className="agent-connect"
        tone="primary"
        onClick={() => dispatch({ type: 'start', phase: 'authorizing' })}
      >
        {text.agent_pair_connect}
      </Button>
    </section>
  )
}
export const HostedBotPanel = ({ copy, state, dispatch }: PanelProps) => {
  const bot = state.bots.find((row) => row.id === state.selected)
  if (!bot || state.verified !== bot.id || !state.consent) return null
  return <HostedConsent copy={copy} consent={state.consent} dispatch={dispatch} />
}
