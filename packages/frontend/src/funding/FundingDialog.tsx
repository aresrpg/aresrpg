// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import Modal from '@mui/material/Modal'
import type { ReactNode } from 'react'

// LI.FI and WalletConnect portal dialogs into body. A native top-layer dialog makes them inert.
// Share their modal stack only inside this funding surface; MUI retains focus and restores it on close.
export default function FundingDialog({
  children,
  close,
  label,
}: Readonly<{
  children: ReactNode
  close: () => void
  label: string
}>) {
  return (
    <Modal open onClose={close} sx={(theme) => ({ zIndex: theme.zIndex.drawer - 1 })}>
      <div
        className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/70 text-text backdrop-blur-sm outline-none"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        {children}
      </div>
    </Modal>
  )
}
