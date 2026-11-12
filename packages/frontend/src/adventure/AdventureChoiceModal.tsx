// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, NativeModal } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { GoogleLoginButton } from '../components/GoogleLoginButton.tsx'
import { player_error_text } from '../i18n/player_error.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import './choice.css'

export const AdventureChoiceModal = ({ copy: initial_copy }: Readonly<{ copy: AppCopy }>) => {
  const copy = useAppStore((state) => state.copy ?? initial_copy)
  const onboarding = useAppStore((state) => state.adventure.phase === 'onboarding')
  const session = useAppStore((state) => state.session)
  const text = copy.adventure
  const title = text[onboarding ? 'start_playing' : 'choice_title']!
  const busy = session.auth_status === 'connecting' || session.wallet !== null
  return (
    <NativeModal close={null} label={title} className="adventure-choice">
      <article className="adventure-choice__card">
        <header className="adventure-choice__header">
          <span className="adventure-choice__chapter">{text.journal}</span>
          <span className="adventure-choice__seal" aria-hidden="true">
            ✦
          </span>
          <h1>{title}</h1>
          <p>{text[onboarding ? 'play_description' : 'choice_body']}</p>
        </header>
        <div className="adventure-choice__paths">
          <section>
            {onboarding ? (
              <GoogleLoginButton
                copy={copy}
                ready={session.auth_ready}
                loading={busy}
                login={() => dispatch_app({ type: 'auth/login_google' })}
              />
            ) : (
              <Button tone="primary" onClick={() => dispatch_app({ type: 'adventure/choice', choice: 'play' })}>
                {text.start_playing}
                <span aria-hidden="true"> ↗</span>
              </Button>
            )}
            {!onboarding && <p>{text.play_description}</p>}
            {session.auth_error && <p role="alert">{player_error_text(copy, session.auth_error)}</p>}
          </section>
          <section hidden={onboarding}>
            <Button disabled={busy} onClick={() => dispatch_app({ type: 'adventure/choice', choice: 'continue' })}>
              {text.continue_tutorial}
              <span aria-hidden="true"> →</span>
            </Button>
            <p>{text.continue_description}</p>
          </section>
        </div>
      </article>
    </NativeModal>
  )
}
