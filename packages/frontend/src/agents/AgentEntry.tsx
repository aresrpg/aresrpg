// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { Button } from '@aresrpg/ui'

import { GoogleLoginButton } from '../components/GoogleLoginButton.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { player_error_text } from '../i18n/player_error.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { AgentSetupDialog } from './AgentSetup.tsx'

type Props = Readonly<{ copy: AppCopy; load_player: () => Promise<ComponentType>; start_player: () => void }>
/** Presentation changes only: auth, pairing, custody and funding retain the running app owner. */
export const AgentEntry = ({ copy, load_player, start_player }: Props) => {
  const [Player] = useState(() => lazy(async () => ({ default: await load_player() })))
  const [playing, set_playing] = useState(false)
  const watching = useAppStore((state) => state.session.agent_view.request !== null)
  const active = playing || watching
  useEffect(() => {
    if (active) start_player()
  }, [active, start_player])
  if (active)
    return (
      <Suspense fallback={<p role="status">{copy.loading_universe}</p>}>
        <Player />
      </Suspense>
    )
  const play = () => {
    const url = new URL(location.href)
    // eslint-disable-next-line functional/immutable-data -- this fresh URL is the local Play destination.
    url.pathname = '/'
    url.searchParams.delete('intent')
    history.replaceState(history.state, '', url)
    dispatch_app({ type: 'dialog/open', dialog: null })
    dispatch_app({ type: 'route/changed', pathname: '/' })
    set_playing(true)
  }
  return <AgentEntryScreen copy={copy} play={play} />
}

const AgentEntryScreen = ({ copy, play }: Readonly<{ copy: AppCopy; play: () => void }>) => {
  const session = useAppStore((state) => state.session)
  const locale = useAppStore((state) => state.locale)
  return (
    <LocaleScope locale={locale}>
      <main data-agent-entry="" className="min-h-dvh bg-bg px-5 py-12 text-text">
        <section className="mx-auto flex w-full max-w-xl flex-col gap-6 border border-white/20 bg-surface p-6 sm:p-10">
          <p className="text-sm tracking-widest">ARES RPG</p>
          <h1 className="text-2xl font-semibold">{copy.ui.agent_connect_your}</h1>
          <p>{copy.ui.agent_entry_intro}</p>
          {!session.wallet ? (
            <>
              <GoogleLoginButton
                copy={copy}
                ready={session.auth_ready}
                loading={session.auth_status === 'connecting'}
                login={() => dispatch_app({ type: 'auth/login_google' })}
              />
              {session.auth_error && <p role="alert">{player_error_text(copy, session.auth_error)}</p>}
            </>
          ) : (
            <>
              <output className="break-all text-sm">{session.wallet.address}</output>
              <Button tone="primary" onClick={() => dispatch_app({ type: 'dialog/open', dialog: 'agent_setup' })}>
                {copy.ui.agent_setup}
              </Button>
              <Button onClick={() => dispatch_app({ type: 'auth/disconnected' })}>{copy.wallet_disconnect}</Button>
            </>
          )}
          <Button onClick={play}>{copy.ui.agent_entry_play}</Button>
        </section>
        <AgentSetupDialog copy={copy} />
        <Toasts />
      </main>
    </LocaleScope>
  )
}
