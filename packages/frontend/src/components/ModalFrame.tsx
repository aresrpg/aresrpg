// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { NativeModal, GameWindow } from '@aresrpg/ui'

/** Compatibility API for existing controllers; shared UI owns all window rendering. */
export const ModalFrame = ({
  children,
  close,
  close_label,
  label,
  max_width = 'max-w-md',
}: Readonly<{
  children: ReactNode
  close: (() => void) | null
  close_label: string
  label: string
  max_width?: string
  soft?: boolean
}>) => (
  <NativeModal close={close} label={label} className="aui-modal-scrim">
    <GameWindow
      title={label}
      close={close}
      close_label={close_label}
      className={`w-full ${max_width} max-h-[calc(100dvh-24px)]`}
    >
      <div className="min-h-0 overflow-y-auto">{children}</div>
    </GameWindow>
  </NativeModal>
)
