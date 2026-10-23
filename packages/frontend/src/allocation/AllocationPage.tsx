// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { campaign } from '@aresrpg/immutable/allocation'

import type { AppCopy, CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { copy_text } from '../i18n/copy.ts'
import { create_wallet_runtime } from '../wallet/runtime.ts'
import type { AuthSession } from '../auth.ts'
import { env } from '../env.ts'

import type { AllocationRuntime, AllocationState } from './runtime.ts'
import { allocation_view } from './view.ts'
import { Wallets } from './Wallets.tsx'
import { Entries } from './Entries.tsx'
import { Hero } from './Hero.tsx'
import { Results } from './Results.tsx'
import { useCampaignClosed, useCampaignRefresh } from './clock.tsx'
import { useWalletFeedback } from './wallet_feedback.ts'
import { Notices } from './Notices.tsx'
import { helmet } from './assets.ts'
import './allocation.css'
import './layout.css'

const CampaignStatus = ({
  state,
  phase,
  text,
}: Readonly<{ state: AllocationState; phase: string; text: CopyText }>) => {
  const pending = state.task && !(state.task.kind === 'load' && state.status)
  const labels: Readonly<Record<string, string>> = {
    verify: 'signing',
    link_google: 'signing',
    submit: 'checking_posts',
  }
  const label = pending ? text(labels[state.task!.kind] ?? state.progress ?? 'loading') : text(phase)
  return (
    <span className="phase-chip" role="status">
      {pending && <span className="spinner" aria-hidden="true" />}
      <span>{label}</span>
    </span>
  )
}

export const AllocationPage = ({
  runtime,
  copy,
  locale,
}: Readonly<{ runtime: AllocationRuntime; copy: AppCopy; locale: Locale }>) => {
  const state = useStore(runtime.store)
  const feedback = useWalletFeedback(state)
  const text = copy_text(copy.allocation_page)
  const closed = useCampaignClosed()
  useCampaignRefresh(runtime, !!state.session && !state.error)
  const external = useMemo(
    () =>
      create_wallet_runtime<AuthSession>({
        network: env.network,
        storage: null,
        create_auth: async () => (await import('../auth.ts')).create_external_auth(),
      }),
    []
  )
  const external_state = useStore(external.store)
  const view = allocation_view(state.status, closed ? Date.parse(campaign.submissions_close_at) : 0, state.session)
  const open = !closed && (state.status?.submissions_open ?? true)
  useEffect(() => runtime.observe(), [runtime])
  useEffect(() => external.start(), [external])
  return (
    <div className="allocation-root" ref={feedback}>
      <header className="masthead">
        <a className="wordmark" href="/">
          <img src={helmet} alt="" />
          AresRPG <span>{text('title')}</span>
        </a>
        <CampaignStatus state={state} phase={view.final ? 'final' : open ? 'registration' : 'closed'} text={text} />
        {state.session && (
          <button
            className="btn btn-small"
            disabled={!!state.task}
            onClick={() => runtime.dispatch({ type: 'request', task: { kind: 'logout' } })}
          >
            {copy.wallet_disconnect}
          </button>
        )}
      </header>
      <main className="page">
        <Notices state={state} runtime={runtime} copy={copy} text={text} />
        <Hero view={view} state={state} runtime={runtime} text={text} locale={locale} open={open} />
        <div className="steps">
          <Wallets
            state={state}
            runtime={runtime}
            external={{ state: external_state, dispatch: external.dispatch }}
            google_label={copy.continue_google}
            text={text}
          />
          <Entries state={state} runtime={runtime} text={text} open={open} />
          <Results text={text} final={view.final} open={open} locale={locale} kares_copy={copy.kares_page} />
        </div>
        <p className="fine">{text('footer')}</p>
      </main>
    </div>
  )
}
