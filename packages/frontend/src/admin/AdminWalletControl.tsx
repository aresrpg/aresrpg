// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dispatch_app, useAppStore } from '../store.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'

export const AdminWalletControl = () => {
  const state = useAppStore((state) => state.external_wallet)
  const copy = useAppStore((state) => state.copy)
  return copy ? <WalletControl copy={copy.kares_page} wallet={{ state, dispatch: dispatch_app }} /> : null
}
