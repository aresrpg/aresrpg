// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { CircleAlert } from 'lucide-react'

import { LightPage, LightPageGate } from '../components/LightPage.tsx'
import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { SuinsConfirmation } from '../settings/SuinsConfirmation.tsx'
import { useAppStore } from '../store.ts'

import { AgentLog } from './AgentLog.tsx'
import { AgentSetup, AgentSetupButton } from './AgentSetup.tsx'
import { SilentConsent } from './SilentConsent.tsx'
import { telegram_request } from './silent_consent.ts'
import type { OwnerAnswer } from './owner_state.ts'
import { useOwnerAnswer, useSetupOpensItself } from './useOwnerAnswer.ts'
import { useTelegramRequest } from './useTelegramRequest.ts'

const Waiting = ({ label }: Readonly<{ label: string }>) => (
  <p className="light-page-status" role="status" aria-busy="true">
    <span className="aui-spinner" aria-hidden="true" />
    {label}
  </p>
)

/**
 * A Telegram chat's login. The player asked for it in Telegram, so the page asks nothing: it links
 * the chat by itself, then the Telegram service sends the browser back to the chat. Only a browser
 * with no game session is asked to sign in first.
 */
const TelegramLink = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  const text = copy.ui
  if (!wallet) return <LightPageGate copy={copy} title={text.telegram_link_title} body={text.telegram_link_signin} />
  return (
    <section className="aui-panel light-page-card" data-telegram-link="">
      <h1>{text.telegram_link_title}</h1>
      <SilentConsent
        trusted={(consent) => telegram_request(consent, env.telegram_callback_url)}
        busy={<Waiting label={text.agent_hosted_pending} />}
        failed={
          <div className="agent-connect-error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <p>{text.telegram_link_failed}</p>
          </div>
        }
      />
      <SuinsConfirmation copy={copy} />
    </section>
  )
}

/**
 * A connected agent's page: one status line with the way out, then what the agent does with each hero.
 * The page only shows. Disconnect opens the game's own disconnect dialog, which asks before it acts.
 */
const AgentConnectedPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [leaving, set_leaving] = useState(false)
  return (
    <section className="agent-page" data-connect-agent-page="" data-agent-answer="connected">
      <header className="agent-page-status">
        <span className="agent-page-dot" aria-hidden="true" />
        <h1>{copy.ui.agent_connected}</h1>
        <Button onClick={() => set_leaving(true)}>{copy.wallet_disconnect}</Button>
      </header>
      <AgentLog copy={copy} />
      {leaving && <AgentSetup copy={copy} close={() => set_leaving(false)} />}
      <SuinsConfirmation copy={copy} />
    </section>
  )
}

/**
 * The page of an account with no agent, and the page behind an assistant's request. Until the player
 * dismisses it, the setup dialog opens by itself for an account known to have no agent, and for the
 * request, which waits for the player.
 */
const AgentSetupCard = ({
  copy,
  answer,
  requested,
  dismissed,
  dismiss,
}: Readonly<{ copy: AppCopy; answer: OwnerAnswer; requested: boolean; dismissed: boolean; dismiss: () => void }>) => {
  const opens_itself = useSetupOpensItself()
  const text = copy.ui
  return (
    <section className="aui-panel light-page-card" data-connect-agent-page="" data-agent-answer={answer}>
      <h1>{answer === 'connected' ? text.agent_connected : text.agent_connect_your}</h1>
      <p>{text.agent_page_body}</p>
      <div className="light-page-actions">
        <AgentSetupButton copy={copy} label={text.agent_setup} class_name="aui-button--primary" />
        <a className="aui-button" href="/world">
          {text.agent_page_world}
        </a>
      </div>
      {!dismissed && (requested || opens_itself) && <AgentSetup copy={copy} close={dismiss} />}
      <SuinsConfirmation copy={copy} />
    </section>
  )
}

/**
 * The agent's own page. It shows what the owner check answered and nothing it guessed: while the
 * check runs it says so, with no setup to choose and no button; a connected account reads its agent's
 * log. An assistant's request is shown whatever the answer is, because no owner check runs for it.
 */
const AgentPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  const answer = useOwnerAnswer()
  const [dismissed, set_dismissed] = useState(false)
  const text = copy.ui
  // Read on each render: dismissing an assistant's request takes it out of the address.
  const requested = new URLSearchParams(globalThis.location.search).has('authorization_id')
  if (!wallet) return <LightPageGate copy={copy} title={text.agent_connect_your} body={text.agent_page_signin} />
  const shown = requested ? 'request' : answer
  if (shown === 'unknown')
    return (
      <section className="aui-panel light-page-card" data-connect-agent-page="" data-agent-answer={answer}>
        <Waiting label={text.agent_checking} />
      </section>
    )
  if (shown === 'connected') return <AgentConnectedPage copy={copy} />
  return (
    <AgentSetupCard
      copy={copy}
      answer={answer}
      requested={requested}
      dismissed={dismissed}
      dismiss={() => set_dismissed(true)}
    />
  )
}

/**
 * Connect Your Agent as its own page: the same setup the game opens in a dialog, with the account
 * and no world. The public entry link and an assistant's consent link both land here, so setting up
 * an agent never loads the engine. A Telegram chat's login lands here too, and links by itself.
 */
export const ConnectAgentRoute = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [authorization_id] = useState(() => new URLSearchParams(globalThis.location.search).get('authorization_id'))
  const telegram = useTelegramRequest(authorization_id)
  return (
    <LightPage copy={copy} aura="ember" brand={<strong>AresRPG</strong>}>
      {telegram === null && (
        <section className="aui-panel light-page-card">
          <Waiting label={copy.ui.agent_hosted_pending} />
        </section>
      )}
      {telegram === true && <TelegramLink copy={copy} />}
      {telegram === false && <AgentPage copy={copy} />}
    </LightPage>
  )
}
