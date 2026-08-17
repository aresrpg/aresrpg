// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AdminView } from '../modules/admin.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { BiomePage } from './BiomePage.tsx'
import { ContentPage } from './ContentPage.tsx'
import { OverviewPage } from './OverviewPage.tsx'
import { AdminWalletControl } from './AdminWalletControl.tsx'
import { PublishPage } from './PublishPage.tsx'

const TABS: readonly Readonly<{ id: AdminView; label: string; local?: boolean }>[] = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content', local: true },
  { id: 'biomes', label: 'Biomes', local: true },
  { id: 'publish', label: 'Publish' },
])

const AdminPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const admin = useAppStore((state) => state.admin)
  const local = import.meta.env.DEV
  const dirty = Object.values(admin.editor.files).filter((file) => file?.dirty).length
  return (
    <section className="pointer-events-auto z-[12] flex h-full min-h-0 flex-1 flex-col overflow-hidden border border-white/8 bg-[#0d0d14]/98">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/8 px-4 py-3">
        {TABS.filter(({ local: local_only }) => !local_only || local).map((tab) => (
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
          {local && <span className="text-[#67adff]">Local editor</span>}
          {dirty > 0 && <span className="text-[#efbd45]">{dirty} unsaved</span>}
          {admin.editor.validation && <span className="text-[#ff8caa]">{admin.editor.validation.reds.length} red</span>}
          <AdminWalletControl copy={copy} />
        </div>
      </nav>
      {admin.view === 'overview' && <OverviewPage copy={copy} />}
      {admin.view === 'content' && local && <ContentPage />}
      {admin.view === 'biomes' && local && <BiomePage />}
      {admin.view === 'publish' && <PublishPage />}
    </section>
  )
}

export default AdminPage
