// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useId } from 'react'
import { Button, NativeModal } from '@aresrpg/ui'
import { Bot, Unplug, X } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'

import './agent_connected.css'

/** The approved Verdigris control keeps the shared button and its unclipped outer wrapper. */
export const AgentConnectionButton = ({
  connected,
  label,
  class_name = '',
  open,
  disabled = false,
}: Readonly<{
  connected: boolean
  label: string
  class_name?: string
  open: () => void
  disabled?: boolean
}>) => {
  const button = (
    <Button
      className={`${class_name} ${connected ? 'agent-btn opt-e' : ''}`}
      onClick={open}
      data-agent-setup-button=""
      disabled={disabled}
    >
      <Bot size={16} className="bot" aria-hidden="true" />
      <span className="label">{label}</span>
    </Button>
  )
  return connected ? <span className="e-wrap">{button}</span> : button
}

export const AgentConnectedModal = ({
  copy,
  close,
  disconnect,
  pending = false,
}: Readonly<{
  copy: AppCopy
  close: () => void
  disconnect: () => void
  pending?: boolean
}>) => {
  const title_id = useId()
  return (
    <NativeModal close={close} label={copy.ui.agent_connected} aria-labelledby={title_id} className="aui-modal-scrim">
      <section className="agent-connected" data-agent-connected="">
        <Button className="close" aria-label={copy.wallet_close} onClick={close}>
          <X size={16} aria-hidden="true" />
        </Button>
        <div className="seal" aria-hidden="true">
          <Bot size={26} />
          <span className="gem" />
        </div>
        <h2 id={title_id}>{copy.ui.agent_connected}</h2>
        <Button className="disconnect" disabled={pending} onClick={disconnect}>
          <Unplug size={16} aria-hidden="true" />
          {copy.wallet_disconnect}
        </Button>
      </section>
    </NativeModal>
  )
}
