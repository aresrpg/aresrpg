// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { next_seed_batch } from '@aresrpg/sdk/seed-admin'

import type { AdminView } from '../modules/admin.ts'
import { worlds_source } from '../content/worlds.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { BiomePage } from './BiomePage.tsx'
import { ContentPage } from './ContentPage.tsx'
import { OverviewPage } from './OverviewPage.tsx'
import { AdminWalletPanel } from './AdminWalletPanel.tsx'

const field_class =
  'h-9 w-full border border-white/10 bg-black/25 px-3 text-[10px] text-[#d8d3ca] outline-none focus:border-[#4a9eff]/50 disabled:opacity-45'
const button_class =
  'h-9 cursor-pointer border border-[#4a9eff]/35 bg-[#4a9eff]/8 px-4 text-[9px] tracking-[0.16em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35'

const PublishPage = ({ copy }: Readonly<{ copy: Readonly<Record<string, string>> }>) => {
  const admin = useAppStore((state) => state.admin)
  const wallet = useAppStore((state) => state.admin.wallet.session)
  const busy = admin.status === 'loading' || admin.status === 'executing'
  const complete = !!admin.snapshot?.batches.length && admin.snapshot.batches.every(({ state }) => state === 'complete')
  const completed_batches = admin.snapshot?.batches.filter(({ state }) => state === 'complete').length ?? 0
  const total_batches = admin.snapshot?.batches.length ?? 0
  const target_count = admin.snapshot?.batches.reduce((sum, { targets }) => sum + targets, 0) ?? 0
  const sealed = admin.snapshot?.sealed === true
  const next_batch = next_seed_batch(admin.snapshot)

  return (
    <section className="min-h-full flex-1 overflow-y-auto p-5">
      <header className="border-b border-white/8 pb-5">
        <p className="text-[8px] tracking-[0.25em] text-[#c8963c] uppercase">{copy.kicker}</p>
        <h1 className="mt-2 text-lg font-semibold">{copy.title}</h1>
        <p className="mt-2 max-w-3xl text-[10px] leading-5 text-[#838791]">{copy.body}</p>
      </header>

      <div className="mt-5">
        <AdminWalletPanel copy={copy} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)]">
        <div className="space-y-5">
          <section className="border border-white/8 bg-black/12 p-4">
            <h2 className="text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">{copy.objects}</h2>
            <label className="mt-4 block text-[8px] tracking-[0.14em] text-[#777b86] uppercase">
              {copy.publisher}
              <input
                className={`${field_class} mt-2`}
                disabled={busy || sealed || !wallet}
                onChange={(event) => dispatch_app({ type: 'admin/publisher_changed', publisher: event.target.value })}
                spellCheck={false}
                value={admin.config.publisher}
              />
            </label>
            <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {worlds_source.map(({ world }) => (
                <label className="block text-[8px] tracking-[0.12em] text-[#777b86] uppercase" key={world}>
                  {world}
                  <input
                    className={`${field_class} mt-1`}
                    disabled={busy || sealed || !wallet}
                    onChange={(event) =>
                      dispatch_app({ type: 'admin/world_changed', world, object_id: event.target.value })
                    }
                    spellCheck={false}
                    value={admin.config.worlds[world] ?? ''}
                  />
                </label>
              ))}
            </div>
            <button
              className={`${button_class} mt-4 w-full`}
              disabled={busy || sealed || !wallet}
              onClick={() => dispatch_app({ type: 'admin/refresh' })}
              type="button"
            >
              {admin.status === 'loading' ? copy.inspecting : copy.inspect}
            </button>
          </section>

          {admin.error && (
            <div className="border border-[#ff5a8b]/30 bg-[#ff5a8b]/6 p-4 text-[10px] leading-5 text-[#ff8caa]">
              {admin.error}
            </div>
          )}
        </div>

        <section className="border border-white/8 bg-black/12 p-4">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
            <div>
              <h2 className="text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">{copy.plan}</h2>
              <p className="mt-2 text-[9px] text-[#777b86]">
                {admin.snapshot
                  ? `${completed_batches} / ${total_batches} · ${target_count} ${copy.targets}`
                  : copy.not_inspected}
              </p>
            </div>
            <span className="border border-white/8 bg-black/20 px-3 py-2 text-[8px] tracking-[0.14em] text-[#9699a2] uppercase">
              {sealed ? 'sealed' : admin.status}
            </span>
          </div>

          <div className="mt-4 max-h-[500px] space-y-1 overflow-y-auto pr-1">
            {admin.snapshot?.batches.map((batch) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border border-white/6 bg-white/[0.018] px-3 py-2"
                key={batch.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-[9px] text-[#d8d3ca]">{batch.id}</p>
                  <p className="mt-1 text-[7px] tracking-[0.12em] text-[#626670] uppercase">{batch.phase}</p>
                </div>
                <span className="text-[8px] text-[#626670]">{batch.targets}</span>
                <span
                  className={`text-[8px] tracking-[0.12em] uppercase ${
                    batch.state === 'complete'
                      ? 'text-[#5ecf8d]'
                      : batch.state === 'ready'
                        ? 'text-[#67adff]'
                        : batch.state === 'blocked'
                          ? 'text-[#ff8caa]'
                          : 'text-[#555963]'
                  }`}
                >
                  {batch.state}
                </span>
              </div>
            ))}
          </div>

          {next_batch && (
            <button
              className={`${button_class} mt-4 w-full`}
              disabled={busy || next_batch.state !== 'ready' || !wallet}
              onClick={() => dispatch_app({ type: 'admin/execute', batch: next_batch.id })}
              type="button"
            >
              {admin.status === 'executing' ? copy.executing : `${copy.execute} ${next_batch.id}`}
            </button>
          )}

          {complete && !sealed && (
            <div className="mt-5 border border-[#ff5a8b]/20 bg-[#ff5a8b]/5 p-4">
              <p className="text-[9px] font-semibold text-[#ff8caa] uppercase">{copy.seal_title}</p>
              <p className="mt-2 text-[9px] leading-5 text-[#9b7c86]">{copy.seal_body}</p>
              {!admin.seal_armed ? (
                <button
                  className="mt-4 h-9 w-full cursor-pointer border border-[#ff5a8b]/30 text-[9px] tracking-[0.16em] text-[#ff8caa] uppercase"
                  onClick={() => dispatch_app({ type: 'admin/seal_armed', armed: true })}
                  type="button"
                >
                  {copy.arm_seal}
                </button>
              ) : (
                <button
                  className="mt-4 h-9 w-full cursor-pointer border border-[#ff5a8b]/70 bg-[#ff5a8b]/12 text-[9px] tracking-[0.16em] text-[#ffc0d0] uppercase"
                  onClick={() => dispatch_app({ type: 'admin/seal' })}
                  type="button"
                >
                  {copy.seal_forever}
                </button>
              )}
            </div>
          )}

          {sealed && (
            <div className="mt-5 border border-[#5ecf8d]/25 bg-[#5ecf8d]/5 p-4 text-[9px] tracking-[0.14em] text-[#5ecf8d] uppercase">
              {copy.sealed}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

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
        </div>
      </nav>
      {admin.view === 'overview' && <OverviewPage copy={copy} />}
      {admin.view === 'content' && local && <ContentPage />}
      {admin.view === 'biomes' && local && <BiomePage />}
      {admin.view === 'publish' && <PublishPage copy={copy} />}
    </section>
  )
}

export default AdminPage
