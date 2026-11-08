// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useCallback, useState } from 'react'
import { Button, IconButton, NativeModal } from '@aresrpg/ui'
import { Bot, X } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { AgentConnectedHint } from './AgentConnectedHint.tsx'
import { AgentPairing } from './AgentPairing.tsx'
import { AgentHandoff } from './AgentHandoff.tsx'
import type { SetupExchange } from './setup_requests.ts'
import './agent_setup.css'

const chatgpt_logo = '/providers/chatgpt.svg'
const grok_logo = '/providers/grok.svg'

/** Public proof only; no agent signer or custody is stored by the modal. */
export const AgentSetup = ({
  copy,
  close,
  exchange,
}: Readonly<{
  copy: AppCopy
  close: () => void
  exchange?: SetupExchange
}>) => {
  const [provider, select_provider] = useState<string | null>(null)
  const wallet = useAppStore((state) => state.session.wallet)
  const [connected_wallet, set_connected_wallet] = useState<typeof wallet>(null)
  const show_connected = useCallback(() => set_connected_wallet(wallet), [wallet])
  const read_request = wallet?.identity === 'zklogin' ? wallet.read_agent_pairing_request : undefined
  const t = copy.ui
  const providers = [
    { id: 'dot', label: 'ChatGPT', logo: chatgpt_logo },
    { id: 'grok', label: 'Grok Bot', logo: grok_logo },
  ]
  if (wallet && connected_wallet === wallet) return <AgentConnectedHint copy={copy} close={close} />
  const chooser = (
    <>
      <div className="agent-provider-cards" role="group" aria-label={t.agent_choose}>
        {providers.map(({ id, label, logo }) => (
          <button
            key={id}
            type="button"
            className="agent-provider-card"
            aria-pressed={provider === id}
            onClick={() => select_provider(id)}
          >
            <img src={logo} alt="" style={{ colorScheme: 'dark' }} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <p className="agent-setup-details">{t.agent_environment}</p>
    </>
  )
  return (
    <NativeModal close={close} label={t.agent_choose} className="aui-modal-scrim">
      <section className="agent-setup" data-agent-setup="">
        <IconButton className="agent-setup-close" label={copy.wallet_close} icon={<X size={16} />} onClick={close} />
        <h2>{t.agent_choose}</h2>
        {read_request ? (
          <AgentPairing
            key={JSON.stringify([wallet?.address, provider])}
            copy={copy}
            read_request={read_request}
            disabled={!provider}
            exchange={exchange}
            connected={show_connected}
          >
            {chooser}
          </AgentPairing>
        ) : (
          <>
            {chooser}
            <AgentHandoff key={provider} copy={copy} provider={provider} />
          </>
        )}
        <p className="agent-setup-status" role="status" hidden={!!read_request}>
          {t.agent_unavailable}
        </p>
        <div className="agent-setup-details" hidden={!!read_request}>
          <p hidden={!provider}>{t.agent_pair_blocked}</p>
          <a href="/agents/client.txt" target="_blank" rel="noreferrer">
            {t.agent_bootstrap}
          </a>
        </div>
      </section>
    </NativeModal>
  )
}

export const AgentSetupButton = ({
  copy,
  label,
  class_name,
}: Readonly<{
  copy: AppCopy
  label?: string
  class_name?: string
}>) => {
  const [open, set_open] = useState(false)
  return (
    <>
      <Button className={class_name} onClick={() => set_open(true)} data-agent-setup-button="">
        <Bot size={16} />
        {label ?? copy.ui.agent_setup}
      </Button>
      {open && <AgentSetup copy={copy} close={() => set_open(false)} />}
    </>
  )
}

/** Route entry uses the same modal, with the ordinary login boundary owned by PlayerRuntime. */
export const AgentSetupDialog = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const dialog = useAppStore((state) => state.navigation.dialog)
  if (!session.wallet || dialog !== 'agent_setup') return null
  return (
    <AgentSetup
      copy={copy}
      close={() =>
        dispatch_app({
          type: 'dialog/open',
          dialog: session.roster_loaded && session.characters.length === 0 ? 'welcome' : null,
        })
      }
    />
  )
}
