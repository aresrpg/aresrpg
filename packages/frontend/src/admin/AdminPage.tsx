// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { OverviewPage } from './OverviewPage.tsx'
import { AdminWalletControl } from './AdminWalletControl.tsx'

const AdminPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  return (
    <section className="pointer-events-auto z-[12] flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface/50 [&_button:not(:disabled)]:cursor-pointer">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-4 py-3 [&>*]:shrink-0">
        <span className="text-[9px] font-semibold tracking-[0.2em] text-[#c8963c] uppercase">
          {copy.overview_title || 'Overview'}
        </span>
        <div className="ml-auto flex shrink-0 items-center pl-4">
          <AdminWalletControl copy={copy} />
        </div>
      </nav>
      <OverviewPage copy={copy} />
    </section>
  )
}

export default AdminPage
