// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The AI page. Connected, it shows the agent's log; otherwise it lays the setup in place: an assistant's
// request, or what the owner check answered. The page only shows: the owner sends, takes back and
// disconnects the bot from the portfolio.
import { ArrowLeftRight, List, Wallet } from 'lucide-react'
import { useId } from 'react'

import { SITE_ADDRESSES } from '../site/routes.ts'
import { SignInStage, useSignInStage } from '../site/SignIn.tsx'
import { SiteLink } from '../site/SiteShell.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { SuinsConfirmation } from '../settings/SuinsConfirmation.tsx'
import { useSiteStore } from '../store.ts'

import { agent_text } from './activity_text.ts'
import { AgentLog } from './AgentLog.tsx'
import { AgentSetupBody } from './AgentSetup.tsx'
import { agent_request_id } from './owner_state.ts'
import { useOwnerAnswer } from './useOwnerAnswer.ts'

/** A connected agent: one status line, then the log of what the agent does with each hero. */
const AgentConnected = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <>
    <header className="agent-page-status">
      <span className="agent-page-dot" aria-hidden="true" />
      <h1>{copy.ui.agent_connected}</h1>
    </header>
    <section className="agent-term" aria-labelledby="agent-term-title">
      <h2 id="agent-term-title">{agent_text(copy, 'log_title')}</h2>
      <AgentLog copy={copy} />
    </section>
    <p className="agent-log-note">
      <SiteLink href={SITE_ADDRESSES.portfolio}>{agent_text(copy, 'manage_note')}</SiteLink>
    </p>
  </>
)

const AgentPage = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const title_id = useId()
  const staged = useSignInStage()
  const requested = useSiteStore(({ location }) => agent_request_id(location.search) !== null)
  const answer = useOwnerAnswer()
  if (staged)
    return (
      <SignInStage
        copy={copy}
        title={copy.ui.agent_connect_your}
        body={copy.ui.agent_page_signin}
        facts={[
          { icon: Wallet, title: agent_text(copy, 'stage_wallet_title'), body: agent_text(copy, 'stage_wallet') },
          { icon: List, title: agent_text(copy, 'stage_log_title'), body: agent_text(copy, 'stage_log') },
          {
            icon: ArrowLeftRight,
            title: agent_text(copy, 'stage_charge_title'),
            body: agent_text(copy, 'stage_charge'),
          },
        ]}
      />
    )
  const shown = requested ? 'request' : answer
  return (
    <section className="agent-page" data-agent-answer={shown}>
      {shown === 'connected' ? (
        <AgentConnected copy={copy} />
      ) : (
        <div className="agent-setup" data-agent-setup="">
          <AgentSetupBody copy={copy} title_id={title_id} />
        </div>
      )}
      <SuinsConfirmation copy={copy} />
    </section>
  )
}

export default AgentPage
