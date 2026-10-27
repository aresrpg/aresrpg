// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'
import { NativeModal } from '@aresrpg/ui'

// Privy's connector lends modality through the shared native-dialog lifecycle.
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
    <NativeModal close={close} label={label} className="aui-modal-scrim">
      {children}
    </NativeModal>
  )
}
