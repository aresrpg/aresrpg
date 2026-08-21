// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The seat was taken by another tab/device on the same account: the link is parked red and
// terminal (never auto-reconnects — that would just steal the seat back and ping-pong both
// windows). This modal says so; the one action is an explicit reconnect of THIS window.

import { MonitorX } from 'lucide-react'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

import { ModalFrame } from './ModalFrame.tsx'

// Mounted only while link_status === 'replaced'; unmounting resets the dismissal, so a NEW
// takeover always announces itself again. Dismissing just reveals the red connection card.
export const SessionReplacedModal = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [dismissed, set_dismissed] = useState(false)
  if (dismissed) return null
  return (
    <ModalFrame close={() => set_dismissed(true)} close_label={copy.wallet_close} label={copy.session_replaced_title}>
      <div className="grid gap-4 p-6 text-center">
        <MonitorX className="mx-auto text-[#ff7d9f]" size={28} strokeWidth={1.5} />
        <h2 className="text-[12px] font-semibold tracking-[0.18em] text-[#e8e4dc] uppercase">
          {copy.session_replaced_title}
        </h2>
        <p className="text-[10px] leading-5 text-[#a3a5ad]">{copy.session_replaced_body}</p>
        <button
          className="mx-auto h-9 cursor-pointer border border-[#c8963c]/45 bg-[#c8963c]/8 px-5 text-[9px] tracking-[0.16em] text-[#efc15a] uppercase hover:border-[#c8963c]"
          onClick={() => globalThis.location.reload()}
          type="button"
        >
          {copy.session_replaced_reconnect}
        </button>
      </div>
    </ModalFrame>
  )
}
