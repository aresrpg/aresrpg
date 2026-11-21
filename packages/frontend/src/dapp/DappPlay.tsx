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
import { DappBagFeed } from './DappBag.tsx'
import { DappCraftScope, DappHeroes } from './DappHeroes.tsx'
import { DappHome } from './DappHome.tsx'
import { DappMarket } from './DappMarket.tsx'
import { DappNotices } from './DappNotices.tsx'
import { DappQuest } from './DappQuest.tsx'
import { DappRaid } from './DappRaid.tsx'
import { bot_ready, bot_unreachable, type DappTab } from './state.ts'

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

/** A wait of the bot, named on the board it does not hide. */
const BotWait = ({ label }: Readonly<{ label: string }>) => (
  <p className="dapp-note dapp-bot-wait" role="status" aria-busy="true" data-bot-wait="">
    <span className="aui-spinner" aria-hidden="true" />
    {label}
  </p>
)

export type Stage =
  | 'unavailable'
  | 'signing_in'
  | 'sign_in'
  | 'google'
  | 'connecting'
  | 'connect'
  | 'heroes_failed'
  | 'reading'
  | 'empty'
  | 'asking_bot'
  | 'syncing'
  | 'bot_unreachable'
  | 'board'
/** The stages that show the board and its tabs: the game server has read the bot account. */
const BOARD_STAGES: readonly Stage[] = ['empty', 'asking_bot', 'syncing', 'bot_unreachable', 'board']
export const board_stage = (stage: Stage): boolean => BOARD_STAGES.includes(stage)
/** Sign-in gates come first; Google through Enoki is the only sign-in this surface offers. */
const account_stage = ({ session }: AppState, bot_service: string): Stage | null => {
  if (!bot_service) return 'unavailable'
  const { wallet, auth_status } = session
  if (!wallet) return auth_status === 'connecting' ? 'signing_in' : 'sign_in'
  return wallet.identity === 'zklogin' ? null : 'google'
}
/** The game server says who the heroes are: an empty team only once it is read, null once heroes are named.
 * An empty team shows the board too: Home holds its first steps. */
const heroes_stage = ({ phase, characters }: AppState['session']['agent_inventory']): Stage | null => {
  if (phase === 'failed') return 'heroes_failed'
  if (characters.length) return null
  return phase === 'ready' ? 'empty' : 'reading'
}
/** The bot says what runs. Each state of its answer is a stage of its own, and each one shows the board. */
const bot_stage = (dapp: AppState['dapp']): Stage => {
  if (bot_ready(dapp)) return 'board'
  if (bot_unreachable(dapp)) return 'bot_unreachable'
  return dapp.observation ? 'syncing' : 'asking_bot'
}
/**
 * The page shows all it knows as soon as it knows it, and names exactly what it still waits for.
 * The heroes are the game server's fact, so the board shows once they are named: it never waits for
 * the bot. What the bot has not said yet is one labelled line on that board. Until the bot answers,
 * no hero claims a status and no start acts, because the page never shows a state it is not sure of.
 */
const linked_stage = ({ dapp, session }: AppState): Stage => {
  // Connecting is automatic; the notice shows only after a disconnect or a failed connection.
  const unlinked = {
    idle: 'connecting',
    authorizing: 'connecting',
    exchanging: 'connecting',
    disconnected: 'connect',
  } as const
  if (dapp.link.phase !== 'connected') return unlinked[dapp.link.phase]
  return heroes_stage(session.agent_inventory) ?? bot_stage(dapp)
}
/** `bot_service` is the deployment's bot URL; a parameter keeps the stage a function of its inputs. */
export const play_stage = (state: AppState, bot_service: string = env.bot_service_url): Stage =>
  account_stage(state, bot_service) ?? linked_stage(state)

/** The bot's answer that the board still waits for, by the stage that names it. */
const BOT_WAITS: Readonly<Partial<Record<Stage, string>>> = { asking_bot: 'asking_bot', syncing: 'syncing' }
/**
 * The tab on screen. The market trades as the bot, so it opens only on the board the bot has
 * answered for; until then its tab shows Home, where the wait is named.
 */
export const shown_tab = (tab: DappTab, stage: Stage): DappTab => (tab === 'market' && stage !== 'board' ? 'home' : tab)

/** One view per tab. Each tab owns its own empty, waiting and blocked states. */
const TAB_VIEWS: Readonly<Record<DappTab, (props: Props) => ReactNode>> = {
  home: (props) => <DappHome {...props} />,
  quest: (props) => <DappQuest {...props} />,
  raid: (props) => <DappRaid {...props} />,
  heroes: ({ copy }) => <DappHeroes copy={copy} />,
  market: (props) => <DappMarket {...props} />,
}

/**
 * The board: the tab on screen, under what the bot has not said yet and what it was asked. Every
 * request's outcome shows in the one notice block, whatever tab made it. What entered the bag stands
 * beside every tab but the market, which takes the full width.
 */
const Board = ({ copy, locale, stage }: Props & Readonly<{ stage: Stage }>) => {
  const error = useAppStore(({ dapp }) => dapp.observe_error)
  // An empty account waits for the bot too: its wait is the bot's own, whatever the stage is named.
  const wait = useAppStore(({ dapp }) => BOT_WAITS[bot_stage(dapp)])
  const tab = useAppStore(({ dapp }) => shown_tab(dapp.tab, stage))
  return (
    <div className="dapp-layout" data-tab={tab}>
      <DappCraftScope copy={copy}>
        <div className="dapp-board">
          {error && (
            <p className="dapp-error" role="alert">
              {dapp_text(copy, 'observe_failed')}
            </p>
          )}
          {wait && <BotWait label={dapp_text(copy, wait)} />}
          <DappNotices copy={copy} />
          {TAB_VIEWS[tab]({ copy, locale })}
        </div>
      </DappCraftScope>
      {tab !== 'market' && <DappBagFeed copy={copy} />}
    </div>
  )
}

/**
 * The view of one stage. Each wait has its own stage, so each wait has its own label. One gate at a
 * time: service, sign-in, bot connection, heroes. Then the board, where the bot's own wait is named.
 */
export const DappStage = ({ stage, copy, locale }: Props & Readonly<{ stage: Stage }>) => {
  const text = (key: string) => dapp_text(copy, key)
  const board = () => <Board copy={copy} locale={locale} stage={stage} />
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
    connecting: () => <Loading label={text('connect_busy')} />,
    connect: () => <Connect copy={copy} />,
    heroes_failed: () => <Notice title={text('heroes_failed_title')} body={text('heroes_failed')} />,
    reading: () => <Loading label={text('reading_heroes')} />,
    // Every board stage is the one board: it names the bot's wait, or its failed read, in place.
    empty: board,
    asking_bot: board,
    syncing: board,
    bot_unreachable: board,
    board,
  }
  return views[stage]()
}
