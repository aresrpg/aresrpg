// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { Button, Panel } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore, type AppState } from '../store.ts'
import { env } from '../env.ts'
import { GoogleLoginButton } from '../components/GoogleLoginButton.tsx'

import { dapp_error, dapp_text } from './copy.ts'
import { DappActivities } from './DappActivities.tsx'
import { DappHeroes, DappHeroDetail } from './DappHeroes.tsx'
import { DappPositions } from './DappPositions.tsx'
import { commands_unresolved } from './state.ts'

type Props = Readonly<{ copy: AppCopy; locale: Locale }>

const Notice = ({ title, body, children }: Readonly<{ title: string; body: string; children?: ReactNode }>) => (
  <Panel className="dapp-notice">
    <h1>{title}</h1>
    <p>{body}</p>
    {children}
  </Panel>
)

const SignIn = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const ready = useAppStore(({ session }) => session.auth_ready)
  const status = useAppStore(({ session }) => session.auth_status)
  const error = useAppStore(({ session }) => session.auth_error)
  return (
    <Notice title={dapp_text(copy, 'signin_title')} body={dapp_text(copy, 'signin_body')}>
      <GoogleLoginButton
        copy={copy}
        ready={ready}
        loading={status === 'connecting'}
        login={() => dispatch_app({ type: 'auth/login_google' })}
      />
      {error && (
        <p className="dapp-error" role="alert">
          {dapp_text(copy, 'signin_failed')}
        </p>
      )}
    </Notice>
  )
}

const Connect = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const link = useAppStore(({ dapp }) => dapp.link)
  const busy = link.phase === 'authorizing' || link.phase === 'exchanging'
  const error = link.phase === 'disconnected' ? link.error : null
  return (
    <Notice title={dapp_text(copy, 'connect_title')} body={dapp_text(copy, 'connect_body')}>
      <ul className="dapp-points">
        <li>{dapp_text(copy, 'connect_custody')}</li>
        <li>{dapp_text(copy, 'connect_fees')}</li>
        <li>{dapp_text(copy, 'connect_stop')}</li>
      </ul>
      <Button tone="primary" busy={busy} onClick={() => dispatch_app({ type: 'dapp/connect' })}>
        {dapp_text(copy, busy ? 'connect_busy' : 'connect_action')}
      </Button>
      {error && (
        <p className="dapp-error" role="alert">
          {dapp_error(copy, error)}
        </p>
      )}
    </Notice>
  )
}

const Loading = ({ label }: Readonly<{ label: string }>) => (
  <p className="dapp-loading" role="status" aria-busy="true">
    <span className="aui-spinner" aria-hidden="true" />
    {label}
  </p>
)

const NoHeroes = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <Notice title={dapp_text(copy, 'empty_title')} body={dapp_text(copy, 'empty_body')}>
    <a className="aui-button aui-button--neutral dapp-link-button" href="/world">
      {dapp_text(copy, 'empty_action')}
    </a>
  </Notice>
)

/** Ends the page's bot access on request. Signing out ends it too, so no token stays on the device. */
const Disconnect = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const blocked = useAppStore(({ dapp }) => commands_unresolved(dapp))
  return (
    <section className="dapp-disconnect">
      <p className="dapp-note">{dapp_text(copy, 'disconnect_body')}</p>
      <Button disabled={blocked} onClick={() => dispatch_app({ type: 'dapp/disconnect' })}>
        {dapp_text(copy, 'disconnect_action')}
      </Button>
    </section>
  )
}

const Board = ({ copy, locale }: Props) => {
  const mode = useAppStore(({ dapp }) => dapp.mode)
  const error = useAppStore(({ dapp }) => dapp.observe_error)
  return (
    <div className="dapp-board" data-mode={mode}>
      {error && (
        <p className="dapp-error" role="alert">
          {dapp_text(copy, 'observe_failed')}
        </p>
      )}
      <DappHeroes copy={copy} />
      <DappActivities copy={copy} />
      <DappPositions copy={copy} locale={locale} />
      {mode === 'advanced' && <DappHeroDetail copy={copy} />}
      <Disconnect copy={copy} />
    </div>
  )
}

type Stage =
  | 'unavailable'
  | 'signing_in'
  | 'sign_in'
  | 'google'
  | 'loading'
  | 'connect'
  | 'observe_failed'
  | 'reading'
  | 'syncing'
  | 'empty'
  | 'board'
/** Sign-in gates come first; Google through Enoki is the only sign-in this surface offers. */
const account_stage = (state: AppState): Stage | null => {
  if (!env.bot_service_url) return 'unavailable'
  const { wallet, auth_status } = state.session
  if (!wallet) return auth_status === 'connecting' ? 'signing_in' : 'sign_in'
  return wallet.identity === 'zklogin' ? null : 'google'
}
/** The game server says who the heroes are: known heroes show at once, an empty team only once it is read. */
const heroes_stage = ({ phase, characters }: AppState['session']['agent_inventory']): Stage => {
  if (phase === 'failed') return 'observe_failed'
  if (characters.length) return 'board'
  return phase === 'ready' ? 'empty' : 'syncing'
}
/** The bot says what runs. It and the game server must both have answered before the board shows. */
const bot_stage = ({ dapp, session }: AppState): Stage => {
  const { link, observation, observe_error } = dapp
  if (link.phase !== 'connected') return link.phase === 'idle' ? 'loading' : 'connect'
  if (!observation) return observe_error ? 'observe_failed' : 'reading'
  return observation.ready ? heroes_stage(session.agent_inventory) : 'syncing'
}
export const play_stage = (state: AppState): Stage => account_stage(state) ?? bot_stage(state)

/** One gate at a time: service, sign-in, bot connection, first observation, heroes, then play. */
export const DappPlay = ({ copy, locale }: Props) => {
  const stage = useAppStore(play_stage)
  const text = (key: string) => dapp_text(copy, key)
  const views: Readonly<Record<Stage, () => ReactNode>> = {
    unavailable: () => (
      <Notice title={text('unavailable_title')} body={text('unavailable_body')}>
        <a className="aui-button aui-button--primary" href="/world">
          {text('unavailable_action')}
        </a>
      </Notice>
    ),
    signing_in: () => <Loading label={text('signing_in')} />,
    sign_in: () => <SignIn copy={copy} />,
    google: () => <Notice title={text('google_title')} body={text('google_body')} />,
    loading: () => <Loading label={text('loading')} />,
    connect: () => <Connect copy={copy} />,
    observe_failed: () => <Notice title={text('observe_failed_title')} body={text('observe_failed')} />,
    reading: () => <Loading label={text('reading_heroes')} />,
    syncing: () => <Loading label={text('syncing')} />,
    empty: () => <NoHeroes copy={copy} />,
    board: () => <Board copy={copy} locale={locale} />,
  }
  return views[stage]()
}
