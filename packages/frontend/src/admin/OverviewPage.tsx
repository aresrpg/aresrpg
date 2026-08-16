// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dispatch_app, useAppStore } from '../store.ts'

import { AdminWalletPanel } from './AdminWalletPanel.tsx'
import { admin_content_domains, entity_rows } from './seed_editor.ts'

const Fact = ({
  label,
  value,
  note,
  tone = 'plain',
}: Readonly<{ label: string; value: string; note: string; tone?: 'plain' | 'gold' | 'cyan' }>) => (
  <section
    className={`min-h-28 border bg-white/[0.018] p-4 ${
      tone === 'gold' ? 'border-[#c8963c]/35' : tone === 'cyan' ? 'border-[#4a9eff]/30' : 'border-white/8'
    }`}
  >
    <p className="text-[8px] tracking-[0.18em] text-[#707481] uppercase">{label}</p>
    <p
      className={`mt-4 text-2xl ${tone === 'gold' ? 'text-[#efbd45]' : tone === 'cyan' ? 'text-[#67adff]' : 'text-[#d8d3ca]'}`}
    >
      {value}
    </p>
    <p className="mt-3 text-[8px] leading-4 text-[#666a74]">{note}</p>
  </section>
)

const MissingRow = ({ label, reason }: Readonly<{ label: string; reason: string }>) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-white/7 py-3 text-[9px] first:border-t-0">
    <span className="text-[#92959e]">{label}</span>
    <span className="text-right text-[#626670]" title={reason}>
      — · unavailable
    </span>
  </div>
)

export const OverviewPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const admin = useAppStore((state) => state.admin)
  const online = useAppStore((state) => state.session.online)
  const { validation } = admin.editor
  const corpus_counts = admin_content_domains.map((domain) => ({
    ...domain,
    count: admin.editor.files[domain.id] ? entity_rows(domain.id, admin.editor.files[domain.id]!.value).length : null,
  }))
  const graph_counts = Object.entries(admin.overview.counts).sort((left, right) => right[1] - left[1])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Fact label="Online now" note="server push state" value={online?.toLocaleString() ?? '—'} tone="cyan" />
        <Fact
          label="Indexed users"
          note={admin.overview.status === 'ready' ? 'FalkorDB User nodes' : (admin.overview.error ?? 'loading source')}
          value={admin.overview.counts.User?.toLocaleString() ?? '—'}
        />
        <Fact label="Shop volume 30d" note="global SaleBought rollup not projected yet" value="—" tone="gold" />
        <Fact label="Sales 30d" note="global SaleBought rollup not projected yet" value="—" />
        <Fact
          label="Collectable now"
          note="requires published policy pins and the admin wallet"
          value="—"
          tone="gold"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(540px,1.4fr)_minmax(320px,0.6fr)]">
        <section className="border border-white/8 bg-black/10 p-4">
          <div className="flex items-center justify-between border-b border-white/8 pb-3">
            <div>
              <h2 className="text-[9px] tracking-[0.16em] text-[#c8963c] uppercase">Indexed game state</h2>
              <p className="mt-2 text-[8px] text-[#626670]">Global label counts from the whitelisted server read</p>
            </div>
            <button
              className="h-8 cursor-pointer border border-[#4a9eff]/30 px-3 text-[8px] tracking-[0.12em] text-[#67adff] uppercase disabled:opacity-40"
              disabled={admin.overview.status === 'loading'}
              onClick={() => dispatch_app({ type: 'admin/overview_refresh' })}
              type="button"
            >
              {admin.overview.status === 'loading' ? 'Reading…' : 'Refresh'}
            </button>
          </div>
          {graph_counts.length > 0 ? (
            <div className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              {graph_counts.map(([label, count]) => (
                <div className="flex items-center justify-between border-b border-white/6 py-3 text-[9px]" key={label}>
                  <span className="text-[#8f929b]">{label}</span>
                  <span className="text-[#d8d3ca]">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-12 text-center text-[9px] text-[#626670]">
              {admin.overview.error ?? 'No server counts loaded'}
            </p>
          )}
        </section>

        <section className="border border-white/8 bg-black/10 p-4">
          <h2 className="border-b border-white/8 pb-3 text-[9px] tracking-[0.16em] text-[#c8963c] uppercase">
            Revenue and activity sources
          </h2>
          <MissingRow label="Treasury balance" reason="No deployment treasury pin is published" />
          <MissingRow label="Kiosk royalties" reason="TransferPolicy pins are currently null" />
          <MissingRow label="Lifetime shop gross" reason="Needs a global SaleBought accumulator" />
          <MissingRow label="Marketplace fee" reason="No exact realised-fee projection exists" />
          <MissingRow label="DAU / MAU" reason="Needs unique active AresRPG sender windows" />
          <MissingRow label="zkLogin accounts" reason="Authentication method is not indexed" />
        </section>
      </div>

      <div className="mt-4">
        <AdminWalletPanel copy={copy} />
      </div>

      <section className="mt-4 border border-white/8 bg-black/10 p-4">
        <div className="flex items-center justify-between border-b border-white/8 pb-3">
          <div>
            <h2 className="text-[9px] tracking-[0.16em] text-[#c8963c] uppercase">Authored corpus</h2>
            <p className="mt-2 text-[8px] text-[#626670]">Local JSON source · validator debt stays visible</p>
          </div>
          <div className="text-[8px] tracking-[0.12em] uppercase">
            <span className="text-[#ff8caa]">{validation?.reds.length ?? '—'} red</span>
            <span className="ml-3 text-[#efbd45]">{validation?.warns.length ?? '—'} warn</span>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {corpus_counts.map(({ id, label, count }) => (
            <button
              className="border border-white/7 bg-white/[0.018] p-3 text-left hover:border-[#c8963c]/30"
              key={id}
              onClick={() => {
                dispatch_app({ type: 'admin/editor_domain_selected', domain: id })
                dispatch_app({ type: 'admin/view_changed', view: 'content' })
              }}
              type="button"
            >
              <p className="text-[8px] text-[#707481] uppercase">{label}</p>
              <p className="mt-3 text-lg text-[#d8d3ca]">{count?.toLocaleString() ?? '—'}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
