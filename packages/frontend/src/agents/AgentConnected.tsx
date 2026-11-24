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

/**
 * The quiet face of the same control, for a row it shares with other controls: a 6px dot in the answer's tone (the site
 * status card's colours) and the control's word, in a hairline frame. Every word the control can read is laid in the
 * same cell and only the current one shows, so the box is as wide as its longest word and an answer never moves what
 * stands beside it.
 */
export const AgentStatusButton = ({
  tone,
  label,
  labels,
  open,
  disabled = false,
}: Readonly<{
  tone: string
  label: string
  labels: readonly string[]
  open: () => void
  disabled?: boolean
}>) => (
  <button
    type="button"
    className="inline-grid h-11 items-center rounded-[5px] border border-line bg-surface-high px-3.5 text-[13px] font-semibold text-text transition-colors duration-150 hover:border-line-strong hover:bg-surface-raised focus-visible:border-line-strong focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none"
    onClick={open}
    disabled={disabled}
    data-agent-setup-button=""
  >
    {[...new Set([label, ...labels])].map((word) => (
      <span
        key={word}
        className={`col-1 row-1 flex items-center justify-center gap-2.5 whitespace-nowrap ${word === label ? '' : 'invisible'}`}
        aria-hidden={word === label ? undefined : true}
      >
        <span className={`size-1.5 flex-none rounded-full ${tone}`} aria-hidden="true" />
        {word}
      </span>
    ))}
  </button>
)

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
