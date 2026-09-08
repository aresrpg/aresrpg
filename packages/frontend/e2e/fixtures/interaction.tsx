// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { SendModalShell } from '../../src/components/SendModalShell.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { ModalFrame } from '../../src/components/ModalFrame.tsx'
import { world_keyboard_eligible } from '../../src/game/core/world_input.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')

const Probe = () => {
  const [open, set_open] = useState(false)
  const [nested, set_nested] = useState(false)
  const [terminal, set_terminal] = useState(false)
  const [keys, set_keys] = useState('')
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (world_keyboard_eligible(event)) set_keys((previous) => previous + event.code + ',')
    }
    globalThis.addEventListener('keydown', keydown)
    return () => globalThis.removeEventListener('keydown', keydown)
  }, [])
  return (
    <main className="min-h-screen bg-bg p-8 text-text">
      <button onClick={() => set_open(true)} type="button">
        Open wallet
      </button>
      <button onClick={() => set_terminal(true)} type="button">
        Open terminal
      </button>
      <label>
        Friends
        <input aria-label="Friends" />
      </label>
      <div aria-label="Chat" contentEditable suppressContentEditableWarning />
      <output aria-label="World keys">{keys}</output>
      {open && (
        <ModalFrame close={() => set_open(false)} close_label="Close wallet" label="Wallet">
          <button onClick={() => set_nested(true)} type="button">
            Fund account
          </button>
          <input aria-label="Account" />
          {nested && (
            <AddFundsModal address="0xfixture" copy={copy} network="testnet" on_close={() => set_nested(false)} />
          )}
        </ModalFrame>
      )}
      {terminal && (
        <SendModalShell
          close={() => set_terminal(false)}
          close_label="Close terminal"
          locked
          title="Terminal operation"
        >
          <button onClick={() => set_terminal(false)} type="button">
            Complete
          </button>
        </SendModalShell>
      )}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Probe />)
