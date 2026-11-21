// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Panel } from '@aresrpg/ui'
import { useState, type ReactNode } from 'react'

import { SilentConsent } from '../agents/SilentConsent.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { receive_consent } from '../modules/dapp.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { consent_label, own_request } from './consent.ts'
import { dapp_error, dapp_text } from './copy.ts'
import { DAPP_ROUTE, read_pending, session_storage } from './oauth.ts'

/**
 * The bot sends the dapp's own connection request back here. The page is ours and the player has
 * just signed in to play, so it finishes the connection by itself and names what it waits for. A
 * request that is not this tab's own is refused here. The approved answer returns to this very page:
 * it is taken in place, with no page load, and from then on this is `linked`, the dapp's own view.
 */
export const DappConsent = ({ copy, linked }: Readonly<{ copy: AppCopy; linked: ReactNode }>) => {
  const [pending] = useState(() => read_pending(session_storage(), Date.now()))
  const [linking, set_linking] = useState(false)
  const signing_in = useAppStore(({ session }) => session.wallet === null && session.auth_status === 'connecting')
  if (linking) return linked
  return (
    <SilentConsent
      trusted={pending ? (consent) => own_request(consent, pending, globalThis.location.origin) : null}
      arrive={(redirect) => set_linking(receive_consent(redirect, dispatch_app))}
      busy={(step) => (
        <p className="dapp-loading" role="status" aria-busy="true">
          <span className="aui-spinner" aria-hidden="true" />
          {dapp_text(copy, consent_label(step, signing_in))}
        </p>
      )}
      failed={
        <Panel className="dapp-notice">
          <h1>{dapp_text(copy, 'connect_title')}</h1>
          <p className="dapp-error" role="alert">
            {dapp_error(copy, 'consent_failed')}
          </p>
          <a className="aui-button aui-button--primary dapp-link-button" href={DAPP_ROUTE}>
            {dapp_text(copy, 'connect_action')}
          </a>
        </Panel>
      }
    />
  )
}
