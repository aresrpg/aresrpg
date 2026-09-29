// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { IconButton } from '@aresrpg/ui'
import { Settings, ShieldCheck } from 'lucide-react'
import { is_admin_address } from '../../admin_access.ts'
import { WalletCard } from '../../components/WalletCard.tsx'
import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'
import './world_chrome.css'

export const WorldAccount = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const open = (page: 'settings' | 'admin') => {
    dispatch_app({ type: 'page/open', page })
  }
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
        onClick={() => open('settings')}
      />
      {is_admin_address(session.wallet?.address ?? null) && (
        <IconButton
          className="world-utility-button"
          label={copy.admin}
          icon={<ShieldCheck />}
          onClick={() => open('admin')}
        />
      )}
    </div>
  )
}
