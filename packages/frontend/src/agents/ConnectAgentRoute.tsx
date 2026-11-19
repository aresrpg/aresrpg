// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'

import { LightPage, LightPageGate } from '../components/LightPage.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { SuinsConfirmation } from '../settings/SuinsConfirmation.tsx'
import { useAppStore } from '../store.ts'

import { AgentSetup, AgentSetupButton } from './AgentSetup.tsx'

/**
 * Connect Your Agent as its own page: the same setup the game opens in a dialog, with the account
 * and no world. The public entry link and an assistant's consent link both land here, so setting up
 * an agent never loads the engine. The setup dialog opens on arrival and waits for the player; the
 * button reopens it.
 */
export const ConnectAgentRoute = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore(({ session }) => session.wallet)
  const [arriving, set_arriving] = useState(true)
  const text = copy.ui
  return (
    <LightPage copy={copy} aura="ember" brand={<strong>AresRPG</strong>}>
      {wallet ? (
        <section className="aui-panel light-page-card" data-connect-agent-page="">
          <h1>{text.agent_connect_your}</h1>
          <p>{text.agent_page_body}</p>
          <div className="light-page-actions">
            <AgentSetupButton copy={copy} label={text.agent_setup} class_name="aui-button--primary" />
            <a className="aui-button" href="/world">
              {text.agent_page_world}
            </a>
          </div>
          {arriving && <AgentSetup copy={copy} close={() => set_arriving(false)} />}
          <SuinsConfirmation copy={copy} />
        </section>
      ) : (
        <LightPageGate copy={copy} title={text.agent_connect_your} body={text.agent_page_signin} />
      )}
    </LightPage>
  )
}
