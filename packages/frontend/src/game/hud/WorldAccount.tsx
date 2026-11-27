// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { IconButton } from '@aresrpg/ui'
import { Settings } from 'lucide-react'
import { WalletCard } from '../../components/WalletCard.tsx'
import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import './world_chrome.css'

export const WorldAccount = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  return (
    <div className="world-account">
      <WalletCard
        key={session.wallet?.address}
        copy={copy}
        session={session}
        disconnect={() => dispatch_app({ type: 'auth/disconnected' })}
      />
      <IconButton
        className="world-utility-button"
        label={copy.settings}
        icon={<Settings />}
        onClick={() => dispatch_app({ type: 'page/open', page: 'settings' })}
      />
    </div>
  )
}
