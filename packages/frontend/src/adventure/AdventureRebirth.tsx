// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { NativeModal } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { GoogleLoginButton } from '../components/GoogleLoginButton.tsx'
import { player_error_text } from '../i18n/player_error.ts'

import './rebirth.css'

/** Presentation starts only after the terminal fight's animation queue has drained. */
export const AdventureRebirth = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const victorious = useAppStore((state) => state.adventure.result?.winner === 0)
  const session = useAppStore((state) => state.session)
  return (
    <NativeModal close={null} label={copy.adventure.rebirth_title!} className="adventure-rebirth">
      <div className="adventure-rebirth__soul" aria-hidden="true" />
      <article className="adventure-rebirth__card">
        <h1>{copy.adventure.rebirth_title}</h1>
        {victorious && <p>{copy.adventure.rebirth_victory}</p>}
        <p>{copy.adventure.rebirth_body}</p>
        <GoogleLoginButton
          copy={copy}
          ready={session.auth_ready}
          loading={session.auth_status === 'connecting' || session.wallet !== null}
          login={() => dispatch_app({ type: 'auth/login_google' })}
        />
        {session.auth_error && <p role="alert">{player_error_text(copy, session.auth_error)}</p>}
      </article>
    </NativeModal>
  )
}
