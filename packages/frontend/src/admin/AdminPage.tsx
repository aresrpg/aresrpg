// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AdminView } from '../modules/admin.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { OverviewPage } from './OverviewPage.tsx'
import { AdminWalletControl } from './AdminWalletControl.tsx'
import { PublishPage } from './PublishPage.tsx'

const TABS: readonly Readonly<{ id: AdminView; label: string }>[] = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'publish', label: 'Publish' },
])

const AdminPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const admin = useAppStore((state) => state.admin)
  return (
    <section className="pointer-events-auto z-[12] flex h-full min-h-0 flex-1 flex-col overflow-hidden border border-white/11 bg-[#181c1f]/98">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/8 px-4 py-3">
        {TABS.map((tab) => (
          <button
            className={`h-8 shrink-0 border px-4 text-[8px] tracking-[0.15em] uppercase ${
              admin.view === tab.id
                ? 'border-[#c8963c]/50 bg-[#c8963c]/8 text-[#efc15a]'
                : 'border-transparent text-[#717580] hover:border-white/8 hover:text-[#d8d3ca]'
            }`}
            key={tab.id}
            onClick={() => dispatch_app({ type: 'admin/view_changed', view: tab.id })}
            type="button"
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-3 pl-4 text-[8px] tracking-[0.12em] uppercase">
          <AdminWalletControl copy={copy} />
        </div>
      </nav>
      {admin.view === 'overview' && <OverviewPage copy={copy} />}
      {admin.view === 'publish' && <PublishPage />}
    </section>
  )
}

export default AdminPage
