// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { external_wallet_view } from '../wallet/view.ts'
import { useAppStore } from '../store.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'

export const AdminWalletControl = () => {
  const state = useAppStore((state) => state.external_wallet)
  const copy = useAppStore((state) => state.copy)
  return copy ? <WalletControl copy={copy.kares_page} wallet={external_wallet_view(state)} /> : null
}
