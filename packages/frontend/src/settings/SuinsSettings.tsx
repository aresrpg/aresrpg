// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AtSign, RefreshCw } from 'lucide-react'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { display_suins_name } from '../leaderboards/presentation.ts'
import { dispatch_app, useAppStore } from '../store.ts'

const SuinsMessages = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const state = useAppStore(({ suins }) => suins)
  const t = copy_text(copy.settings_page)
  return (
    <>
      <p hidden={state.request?.kind !== 'load'} className="mt-3 text-[10px] text-muted" role="status">
        {t('suins_loading')}
      </p>
      <p hidden={state.request?.kind !== 'set'} className="mt-3 text-[10px] text-muted" role="status">
        {t('suins_saving')}
      </p>
      <p hidden={!state.error} className="mt-3 text-[10px] text-rose-300" role="alert">
        {t(`suins_${state.error ?? 'read_failed'}`)}
      </p>
      <p hidden={!state.confirmed} className="mt-3 text-[10px] leading-5 text-emerald-300" role="status">
        {t('suins_saved')}
      </p>
    </>
  )
}

export const SuinsSettings = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const state = useAppStore(({ suins }) => suins)
  const wallet = useAppStore(({ session }) => session.wallet)
  const t = copy_text(copy.settings_page)
  const disabled = !wallet || state.request !== null
  const snapshot = state.snapshot ?? { default_name: null, names: [] }
  const name = snapshot.default_name
  const choice = snapshot.names.some((row) => row.name === state.draft) ? state.draft : ''
  return (
    <section className="mt-4 max-w-lg border border-border bg-surface/80 p-4 lg:p-5" data-suins-settings="">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-[11px] tracking-wide text-text">
          <AtSign className="text-gold opacity-70" size={15} />
          {t('suins_title')}
        </h2>
        <button
          type="button"
          className="btn-outline p-2 disabled:opacity-40"
          disabled={disabled}
          aria-label={t('suins_refresh')}
          onClick={() => dispatch_app({ type: 'suins/refresh' })}
        >
          <RefreshCw size={12} />
        </button>
      </header>
      <p className="mt-3 text-[10px] leading-5 text-muted">{t('suins_hint')}</p>
      <p className="mt-3 text-[10px] text-muted">
        {t('suins_current')} ·{' '}
        <strong className="break-all text-gold" title={name ?? undefined}>
          {state.snapshot ? (name ? display_suins_name(name) : t('suins_none')) : '—'}
        </strong>
      </p>
      <p hidden={!!wallet} className="mt-3 text-[10px] text-muted">
        {t('suins_wallet_required')}
      </p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault()
          dispatch_app({ type: 'suins/use' })
        }}
      >
        <fieldset disabled={disabled} className="space-y-3">
          <label className="block text-[10px] text-muted">
            {t('suins_owned')}
            <select
              className="mt-2 w-full border border-border bg-bg px-3 py-2 text-xs text-text disabled:opacity-40"
              disabled={!snapshot.names.length}
              value={choice}
              onChange={(event) => dispatch_app({ type: 'suins/name_changed', name: event.target.value })}
            >
              <option value="">{snapshot.names.length ? t('suins_choose') : t('suins_empty')}</option>
              {snapshot.names.map((row) => (
                <option key={row.object_id} value={row.name}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] text-muted">
            {t('suins_name')}
            <input
              className="mt-2 w-full border border-border bg-bg px-3 py-2 text-xs text-text disabled:opacity-40"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={state.draft}
              placeholder={t('suins_placeholder')}
              onChange={(event) => dispatch_app({ type: 'suins/name_changed', name: event.target.value })}
            />
          </label>
          <p className="text-[9px] leading-5 text-muted">{t('suins_target_hint')}</p>
          <button
            type="submit"
            className="btn-outline px-4 py-2 text-[10px] uppercase disabled:opacity-40"
            disabled={!state.draft.trim()}
          >
            {t('suins_use')}
          </button>
        </fieldset>
      </form>
      <SuinsMessages copy={copy} />
    </section>
  )
}
