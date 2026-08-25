// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { next_seed_batch } from '@aresrpg/sdk/seed-admin'

import { dispatch_app, useAppStore } from '../store.ts'

import { DeploymentTerminal } from './DeploymentTerminal.tsx'

const action_class =
  'h-10 cursor-pointer border px-5 text-[9px] tracking-[0.15em] uppercase transition disabled:cursor-not-allowed disabled:opacity-30'

const Step = ({
  number,
  title,
  body,
  state,
  children,
}: Readonly<{
  number: string
  title: string
  body: string
  state: string
  children: React.ReactNode
}>) => (
  <section className="relative overflow-hidden border-b border-white/8 py-6 last:border-b-0">
    <div className="grid gap-5 lg:grid-cols-[52px_minmax(220px,0.75fr)_minmax(360px,1.25fr)] lg:items-center">
      <span className="text-3xl font-light text-white/10">{number}</span>
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-[11px] tracking-[0.16em] text-[#ded9d0] uppercase">{title}</h2>
          <span className="text-[7px] tracking-[0.12em] text-[#68707d] uppercase">{state}</span>
        </div>
        <p className="mt-2 max-w-md text-[8px] leading-4 text-[#676c77]">{body}</p>
      </div>
      <div>{children}</div>
    </div>
  </section>
)

// eslint-disable-next-line complexity -- One linear deployment checklist renders mutually exclusive lifecycle states.
export const PublishPage = () => {
  const admin = useAppStore((state) => state.admin)
  const { deployment } = admin
  const { pins } = deployment
  const wallet = admin.wallet.session
  const contract_published = !!pins?.package
  const published =
    contract_published &&
    !!pins.item_policy?.id &&
    !!pins.character_policy?.id &&
    !!pins.item_protected_policy?.id &&
    !!pins.character_protected_policy?.id
  const complete = !!admin.snapshot?.batches.length && admin.snapshot.batches.every(({ state }) => state === 'complete')
  const sealed = admin.frozen
  const completed = admin.snapshot?.batches.filter(({ state }) => state === 'complete').length ?? 0
  const total = admin.snapshot?.batches.length ?? 0
  const next = next_seed_batch(admin.snapshot)
  const seed_busy = admin.status === 'loading' || admin.status === 'executing'
  const writable_changes = (admin.changes?.changed.length ?? 0) + (admin.changes?.board_removals.length ?? 0)
  const deploy_busy = ['loading', 'compiling', 'publishing', 'upgrading', 'resetting', 'operating'].includes(
    deployment.status
  )

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,rgba(74,158,255,0.07),transparent_32%),radial-gradient(circle_at_15%_25%,rgba(200,150,60,0.06),transparent_28%)] px-6 py-5">
      <header className="mx-auto max-w-6xl border-b border-white/8 pb-5">
        <p className="text-[8px] tracking-[0.24em] text-[#c8963c] uppercase">Deployment control</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl text-[#e4dfd6]">Publish safely, in order.</h1>
            <p className="mt-2 max-w-2xl text-[9px] leading-5 text-[#747985]">
              Build locally, sign with the connected admin wallet, publish content, then remove authoring permanently.
            </p>
          </div>
          <span className="text-[8px] tracking-[0.14em] text-[#67adff] uppercase">
            {deployment.network ?? '—'} · {published ? 'deployed' : 'not deployed'}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl">
        <Step
          body="Compiles pure math first with warnings as errors. Publish checks and compiles each dependent in order."
          number="01"
          state={deployment.artifact ? 'compiled' : deployment.status}
          title="Compile contracts"
        >
          <button
            className={`${action_class} border-[#4a9eff]/40 bg-[#4a9eff]/8 text-[#72b5ff]`}
            disabled={deploy_busy || deployment.status === 'unavailable' || contract_published}
            onClick={() => dispatch_app({ type: 'admin/contracts_compile' })}
            type="button"
          >
            {deployment.status === 'compiling'
              ? 'Compiling…'
              : deployment.artifact
                ? 'Compile again'
                : 'Compile contracts'}
          </button>
        </Step>

        <Step
          body="Publishes changed packages in dependency order — math, control, content, then game — and records every created object."
          number="02"
          state={
            published
              ? 'published'
              : contract_published
                ? 'bootstrap required'
                : wallet
                  ? 'wallet ready'
                  : 'wallet required'
          }
          title="Publish contracts"
        >
          {published ? (
            <div className="flex flex-wrap items-center gap-3 text-[8px]">
              <span className="text-[#5ecf8d]">✓ Package published</span>
              <span className="max-w-64 truncate font-mono text-[#606671]" title={pins?.package ?? ''}>
                {pins?.package}
              </span>
            </div>
          ) : (
            <button
              className={`${action_class} border-[#c8963c]/45 bg-gradient-to-r from-[#c8963c]/14 to-[#4a9eff]/8 text-[#efbd45]`}
              disabled={deploy_busy || !deployment.artifact || !wallet}
              onClick={() => dispatch_app({ type: 'admin/contracts_publish' })}
              type="button"
            >
              {deployment.status === 'publishing'
                ? 'Publishing…'
                : contract_published
                  ? 'Finish deployment'
                  : 'Publish contracts'}
            </button>
          )}
        </Step>

        <Step
          body="Emergency brake for player-facing Move doors. Content administration remains available. This is reversible."
          number="03"
          state={deployment.paused === null ? 'state unknown' : deployment.paused ? 'paused' : 'live'}
          title="Game operations"
        >
          <div className="flex flex-wrap gap-2">
            <button
              className={`${action_class} border-[#ff5a8b]/35 bg-[#ff5a8b]/7 text-[#ff8caa]`}
              disabled={deploy_busy || !published || !wallet || deployment.paused === true}
              onClick={() => dispatch_app({ type: 'admin/game_pause', paused: true })}
              type="button"
            >
              Pause game
            </button>
            <button
              className={`${action_class} border-[#5ecf8d]/35 bg-[#5ecf8d]/7 text-[#74dda0]`}
              disabled={deploy_busy || !published || !wallet || deployment.paused === false}
              onClick={() => dispatch_app({ type: 'admin/game_pause', paused: false })}
              type="button"
            >
              Resume game
            </button>
          </div>
        </Step>

        <Step
          body="Upgrade preserves package lineages. Republish replaces core and each changed dependency, while reusing unchanged packages."
          number="04"
          state={
            deployment.status === 'upgrading' ? 'upgrading' : deployment.status === 'resetting' ? 'resetting' : 'ready'
          }
          title="Maintain contracts"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={`${action_class} border-[#4a9eff]/40 bg-[#4a9eff]/8 text-[#72b5ff]`}
                disabled={deploy_busy || !published || !wallet || deployment.paused !== false}
                onClick={() => dispatch_app({ type: 'admin/contracts_upgrade' })}
                type="button"
              >
                {deployment.status === 'upgrading' ? 'Upgrading…' : 'Upgrade + bump version'}
              </button>
              <span className="max-w-md text-[8px] leading-4 text-[#68707d]">
                Only changed packages request confirmation. A changed game package is activated last.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-white/6 pt-3">
              {!deployment.republish_armed ? (
                <button
                  className={`${action_class} border-[#ff5a8b]/30 text-[#ff8caa]`}
                  disabled={deploy_busy || !published || !wallet}
                  onClick={() => dispatch_app({ type: 'admin/republish_armed', armed: true })}
                  type="button"
                >
                  Republish core
                </button>
              ) : (
                <>
                  <button
                    className={`${action_class} border-[#ff5a8b]/70 bg-[#ff5a8b]/14 text-[#ffd0dc]`}
                    disabled={deploy_busy}
                    onClick={() => dispatch_app({ type: 'admin/contracts_republish' })}
                    type="button"
                  >
                    Abandon local deployment
                  </button>
                  <button
                    className={`${action_class} border-white/10 text-[#777d87]`}
                    disabled={deploy_busy}
                    onClick={() => dispatch_app({ type: 'admin/republish_armed', armed: false })}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              )}
              <span className="max-w-lg text-[8px] leading-4 text-[#8c6570]">
                Clears this network&apos;s local pins after returning temporary seed-session SUI. Recreate FalkorDB and
                the indexer for the replacement package.
              </span>
            </div>
          </div>
        </Step>

        <Step
          body="One wallet approval opens a temporary local session. Checking compares the JSON files against the chain: missing rows are created, changed rows can be rewritten, and the differences are listed below before anything is signed."
          number="05"
          state={sealed ? 'sealed' : admin.snapshot ? `${completed}/${total} batches` : 'not inspected'}
          title="Publish all seeds"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={`${action_class} border-white/15 text-[#aeb3bc]`}
                disabled={seed_busy || !published || !wallet || sealed}
                onClick={() => dispatch_app({ type: 'admin/refresh' })}
                type="button"
              >
                {admin.status === 'loading' ? 'Checking…' : 'Check seed status'}
              </button>
              {next && (
                <button
                  className={`${action_class} border-[#4a9eff]/45 bg-[#4a9eff]/9 text-[#72b5ff]`}
                  disabled={seed_busy || next.state !== 'ready' || !wallet}
                  onClick={() => dispatch_app({ type: 'admin/publish_all' })}
                  type="button"
                >
                  {admin.operation?.type === 'all' ? 'Publishing…' : 'Publish all seeds'}
                </button>
              )}
              {complete && admin.cleanup === 'needed' && (
                <button
                  className={`${action_class} border-[#c8963c]/45 bg-[#c8963c]/9 text-[#efbd45]`}
                  disabled={seed_busy || !wallet}
                  onClick={() => dispatch_app({ type: 'admin/release' })}
                  type="button"
                >
                  {admin.operation?.type === 'release' ? 'Closing session…' : 'Close temporary session'}
                </button>
              )}
              {complete && admin.cleanup === 'closed' && (
                <span className="text-[8px] text-[#5ecf8d]">✓ Content published · temporary session closed</span>
              )}
              {complete && admin.cleanup !== 'closed' && (
                <span className="text-[8px] text-[#5ecf8d]">✓ All content published</span>
              )}
              {writable_changes > 0 && !admin.changes?.errors.length && (
                <button
                  className={`${action_class} border-[#c8963c]/45 bg-[#c8963c]/9 text-[#efbd45]`}
                  disabled={seed_busy || !wallet || sealed}
                  onClick={() => dispatch_app({ type: 'admin/apply_changes' })}
                  type="button"
                >
                  {admin.operation?.type === 'changes'
                    ? 'Writing changes…'
                    : `Write ${writable_changes} change${writable_changes === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
            {admin.changes && (
              <div className="max-w-2xl space-y-2 border-l-2 border-white/12 bg-[#080b10]/70 px-4 py-3 text-[8px]">
                <div className="flex flex-wrap gap-4 tracking-[0.1em] uppercase">
                  <span className="text-[#72b5ff]">{admin.changes.new_count} new</span>
                  <span className="text-[#efbd45]">{admin.changes.changed.length} changed</span>
                  <span className="text-[#ff8caa]">{admin.changes.board_removals.length} boards removed</span>
                  <span className="text-[#ff8caa]">{admin.changes.removed.length} removed from files</span>
                  <span className="text-[#697686]">{admin.changes.unchanged} up to date</span>
                </div>
                {admin.changes.errors.length > 0 && (
                  <div className="text-[#ff5a8b]">
                    ✕ nothing can be written until the files are fixed · {admin.changes.errors.join(' · ')}
                  </div>
                )}
                {admin.changes.changed.length > 0 && (
                  <div className="text-[#d9c08a]">changed · {admin.changes.changed.join(' · ')}</div>
                )}
                {admin.changes.board_removals.length > 0 && (
                  <div className="text-[#ff9bb6]">
                    removed from the board catalog · {admin.changes.board_removals.join(' · ')}
                  </div>
                )}
                {admin.changes.removed.length > 0 && (
                  <div className="text-[#ff9bb6]">
                    removed from files (still live on chain — retire them by editing whatever points at them) ·{' '}
                    {admin.changes.removed.join(' · ')}
                  </div>
                )}
                {admin.changes.fixed.length > 0 && (
                  <div className="text-[#ff9bb6]">
                    cannot rewrite (airdrops and gift cards are one-shot — add a new row under a new name) ·{' '}
                    {admin.changes.fixed.join(' · ')}
                  </div>
                )}
              </div>
            )}
            {admin.progress && (
              <div className="max-w-2xl border-l-2 border-[#4a9eff]/55 bg-[#080b10]/70 px-4 py-3">
                <div className="flex items-center justify-between gap-4 text-[8px] tracking-[0.1em] uppercase">
                  <span className="text-[#8fbce9]">
                    {admin.progress.phase}
                    {admin.progress.label ? ` · ${admin.progress.label}` : ''}
                  </span>
                  <span className="font-mono text-[#697686]">
                    {admin.progress.total ? `${admin.progress.current}/${admin.progress.total}` : 'starting'}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden bg-white/7">
                  <div
                    className="h-full bg-gradient-to-r from-[#286fb5] to-[#65b7ff] transition-[width] duration-200"
                    style={{
                      width: `${
                        admin.progress.total ? Math.max(2, (admin.progress.current / admin.progress.total) * 100) : 2
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </Step>

        <Step
          body="Permanently freezes every content door — spells, mobs, worlds, boards, items, recipes, supply. There is no unfreeze and no recovery transaction."
          number="06"
          state={sealed ? 'permanent' : complete ? 'available' : 'locked'}
          title="Freeze content forever"
        >
          {sealed ? (
            <span className="text-[9px] tracking-[0.12em] text-[#5ecf8d] uppercase">✓ Content frozen forever</span>
          ) : !admin.seal_armed ? (
            <button
              className={`${action_class} border-[#ff5a8b]/30 text-[#ff8caa]`}
              disabled={!complete || seed_busy || !wallet}
              onClick={() => dispatch_app({ type: 'admin/seal_armed', armed: true })}
              type="button"
            >
              Arm permanent freeze
            </button>
          ) : (
            <button
              className={`${action_class} border-[#ff5a8b]/70 bg-[#ff5a8b]/14 text-[#ffd0dc]`}
              disabled={seed_busy}
              onClick={() => dispatch_app({ type: 'admin/seal' })}
              type="button"
            >
              Freeze content permanently
            </button>
          )}
        </Step>
      </div>

      {(deployment.error || admin.error) && (
        <div className="mx-auto mt-5 max-w-6xl border-l-2 border-[#ff5a8b] bg-[#ff5a8b]/6 p-4 text-[9px] text-[#ff9bb6]">
          {deployment.error ?? admin.error}
        </div>
      )}
      <DeploymentTerminal entries={admin.log} />
    </section>
  )
}
