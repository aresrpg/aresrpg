// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Panel } from '@aresrpg/ui'
import { useEffect, useState } from 'react'

import { useHostedConnect } from '../agents/useHostedConnect.ts'
import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { silent_step } from './consent.ts'
import { dapp_error, dapp_text } from './copy.ts'
import { DAPP_ROUTE, read_pending, session_storage } from './oauth.ts'

/**
 * The bot sends the dapp's own connection request back here. The page is ours and the player has
 * just signed in to play, so it finishes the connection by itself and shows only that it is
 * connecting. A request that is not this tab's own is refused here.
 */
export const DappConsent = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  const [authorization_id] = useState(() => new URLSearchParams(globalThis.location.search).get('authorization_id'))
  const [pending] = useState(() => read_pending(session_storage(), Date.now()))
  const { state, dispatch } = useHostedConnect(wallet, env.bot_service_url, authorization_id)
  const step = silent_step(state, pending, globalThis.location.origin)
  useEffect(() => {
    if (step === 'authenticating' || step === 'authorizing') dispatch({ type: 'start', phase: step })
  }, [step, dispatch])
  if (state.phase === 'failed' || step === 'refused')
    return (
      <Panel className="dapp-notice">
        <h1>{dapp_text(copy, 'connect_title')}</h1>
        <p className="dapp-error" role="alert">
          {dapp_error(copy, 'consent_failed')}
        </p>
        <a className="aui-button aui-button--primary dapp-link-button" href={DAPP_ROUTE}>
          {dapp_text(copy, 'connect_action')}
        </a>
      </Panel>
    )
  return (
    <p className="dapp-loading" role="status" aria-busy="true">
      <span className="aui-spinner" aria-hidden="true" />
      {dapp_text(copy, 'connect_busy')}
    </p>
  )
}
