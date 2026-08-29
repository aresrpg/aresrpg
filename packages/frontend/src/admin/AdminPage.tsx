// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AdminView } from '../modules/admin.ts'
import { category_pill } from '../encyclopedia/components.tsx'
import { dispatch_app, useAppStore } from '../store.ts'

import { OverviewPage } from './OverviewPage.tsx'
import { AdminWalletControl } from './AdminWalletControl.tsx'
import { PublishPage } from './PublishPage.tsx'
import { SalesHistoryPage } from './SalesHistoryPage.tsx'

const TABS: readonly Readonly<{ id: AdminView; copy_key: string; fallback: string }>[] = Object.freeze([
  { id: 'overview', copy_key: 'overview_title', fallback: 'Overview' },
  { id: 'sales', copy_key: 'sales_history', fallback: 'Sales history' },
  { id: 'publish', copy_key: 'title', fallback: 'Publish' },
])

const AdminPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const view = useAppStore((state) => state.admin.view)
  return (
    <section className="pointer-events-auto z-[12] flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface/50 [&_button:not(:disabled)]:cursor-pointer">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-4 py-3 [&>*]:shrink-0">
        {TABS.map((tab) => (
          <button
            className={category_pill(view === tab.id)}
            key={tab.id}
            onClick={() => dispatch_app({ type: 'admin/view_changed', view: tab.id })}
            type="button"
          >
            {copy[tab.copy_key] || tab.fallback}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center pl-4">
          <AdminWalletControl copy={copy} />
        </div>
      </nav>
      {view === 'overview' && <OverviewPage copy={copy} />}
      {view === 'sales' && <SalesHistoryPage copy={copy} />}
      {view === 'publish' && <PublishPage />}
    </section>
  )
}

export default AdminPage
