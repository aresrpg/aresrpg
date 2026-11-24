// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'
import { Button, ProgressBar } from '@aresrpg/ui'
import { CircleAlert, CircleCheck, Download, Loader2 } from 'lucide-react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import type { WalletImportFailure, WalletImportState, WalletImportStep } from '../modules/wallet_import.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'
import { external_wallet_view } from '../wallet/view.ts'
import { format_sui } from '../wallet_amount.ts'

type Plan = Extract<WalletImportStep, { kind: 'ready' }>['plan']
type Finished = Extract<WalletImportStep, { kind: 'done' }>
type Importing = Extract<WalletImportStep, { kind: 'importing' }>

const Status = ({ children }: Readonly<{ children: ReactNode }>) => (
  <p className="flex items-center gap-3 text-xs leading-5 text-muted" role="status">
    <Loader2 className="shrink-0 animate-spin text-gold" size={16} aria-hidden="true" />
    {children}
  </p>
)

const Left = ({ left, t }: Readonly<{ left: Plan['left']; t: CopyText }>) => (
  <>
    {left.roster > 0 && (
      <p className="text-[11px] leading-5 text-muted">{t('import_left_roster', { count: left.roster })}</p>
    )}
    {left.listed > 0 && (
      <p className="text-[11px] leading-5 text-muted">{t('import_left_listed', { count: left.listed })}</p>
    )}
  </>
)

const Summary = ({ plan, t, locale }: Readonly<{ plan: Plan; t: CopyText; locale: string }>) => {
  const characters = plan.characters.length + plan.pending.characters.length
  const rows = [
    [t('import_characters'), String(characters)],
    [t('import_items'), String(plan.assets - characters)],
    [t('import_fee'), `${format_sui(plan.royalty_mist, 3, locale)} SUI`],
  ] as const
  return (
    <>
      <dl className="flex flex-col gap-2 rounded border border-border bg-black/25 px-4 py-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-5 text-muted">{t('import_fee_note')}</p>
      {plan.pending.characters.length + plan.pending.items.length > 0 && (
        <p className="text-[11px] leading-5 text-muted">{t('import_pending')}</p>
      )}
      <Left left={plan.left} t={t} />
    </>
  )
}

const failure_text = (error: WalletImportFailure, t: CopyText, wallet: string, locale: string): string => {
  if (error.kind === 'busy') return t('import_busy')
  if (error.kind === 'failed') return error.message
  return error.payer === 'owner'
    ? t('import_owner_funding')
    : t('import_source_funding', { wallet, amount: format_sui(error.required_mist, 3, locale) })
}

const Failure = ({
  error,
  t,
  wallet,
  locale,
}: Readonly<{ error: WalletImportFailure; t: CopyText; wallet: string; locale: string }>) => (
  <div className="flex flex-col items-start gap-3">
    <p className="flex gap-3 text-xs leading-5 text-rose-300" role="alert">
      <CircleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
      {failure_text(error, t, wallet, locale)}
    </p>
    {error.kind === 'failed' && error.resumable && (
      <p className="text-[11px] leading-5 text-muted">{t('import_resumable')}</p>
    )}
    <Button type="button" onClick={() => dispatch_app({ type: 'wallet_import/refresh' })}>
      {t('import_retry')}
    </Button>
  </div>
)

const Running = ({ step, t, wallet }: Readonly<{ step: Importing; t: CopyText; wallet: string }>) => {
  const { progress } = step
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <Status>{progress?.signer === 'owner' ? t('import_sign_owner') : t('import_sign_source', { wallet })}</Status>
      {progress && (
        <ProgressBar
          label={t('import_running', { moved: progress.moved, total: progress.total })}
          value={progress.moved}
          max={progress.total}
        />
      )}
    </div>
  )
}

const Ready = ({ plan, t, locale }: Readonly<{ plan: Plan; t: CopyText; locale: string }>) =>
  plan.assets === 0 ? (
    <>
      <p className="text-xs leading-5 text-muted">{t('import_empty')}</p>
      <Left left={plan.left} t={t} />
    </>
  ) : (
    <>
      <Summary plan={plan} t={t} locale={locale} />
      <div className="flex justify-end">
        <Button type="button" tone="primary" onClick={() => dispatch_app({ type: 'wallet_import/start' })}>
          <Download size={14} aria-hidden="true" />
          {t('import_start')}
        </Button>
      </div>
    </>
  )

const Done = ({ done, t }: Readonly<{ done: Finished; t: CopyText }>) => (
  <>
    <p className="flex gap-3 text-xs leading-5 text-emerald-300" role="status">
      <CircleCheck className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
      {t('import_done', { count: done.moved })}
    </p>
    <Left left={done.left} t={t} />
    <div className="flex justify-end">
      <Button type="button" tone="primary" onClick={() => dispatch_app({ type: 'wallet_import/close' })}>
        {t('import_done_close')}
      </Button>
    </div>
  </>
)

const Idle = ({ copy, view, t }: Readonly<{ copy: AppCopy; view: WalletImportState; t: CopyText }>) => {
  const external = useAppStore((state) => state.external_wallet)
  const locale = useAppStore((state) => state.locale)
  const wallet = view.source?.wallet_name ?? ''
  return (
    <>
      <p className="text-xs leading-5 text-muted">{t(view.source ? 'import_hint' : 'import_connect')}</p>
      <div className="w-fit max-w-full">
        <WalletControl copy={copy.kares_page} wallet={external_wallet_view(external)} />
      </div>
      {view.step.kind === 'loading' && <Status>{t('import_loading')}</Status>}
      {view.step.kind === 'failed' && <Failure error={view.step.error} t={t} wallet={wallet} locale={locale} />}
      {view.step.kind === 'ready' && <Ready plan={view.step.plan} t={t} locale={locale} />}
    </>
  )
}

const ImportBody = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const view = useAppStore((state) => state.wallet_import)
  const t = copy_text(copy.settings_page)
  if (view.step.kind === 'importing') return <Running step={view.step} t={t} wallet={view.source?.wallet_name ?? ''} />
  if (view.step.kind === 'done') return <Done done={view.step} t={t} />
  return <Idle copy={copy} view={view} t={t} />
}

/** The one import window. It mounts once at the app root, so every entry opens the same window
 * and a running import keeps showing when its entry page closes. */
export const WalletImportWindow = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const open = useAppStore((state) => state.wallet_import.open)
  const running = useAppStore((state) => state.wallet_import.step.kind === 'importing')
  const t = copy_text(copy.settings_page)
  if (!open) return null
  return (
    <ModalFrame
      label={t('import_title')}
      close={running ? null : () => dispatch_app({ type: 'wallet_import/close' })}
      close_label={copy.wallet_close}
    >
      <div className="flex flex-col gap-4 p-6 text-text" data-wallet-import-window="">
        <ImportBody copy={copy} />
      </div>
    </ModalFrame>
  )
}

/** The Settings entry. */
export const WalletImport = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const signed_in = useAppStore((state) => state.session.wallet?.identity === 'zklogin')
  const t = copy_text(copy.settings_page)
  return (
    <section className="aui-panel settings-name" data-wallet-import="">
      <h2 className="flex items-center gap-3 text-[11px] tracking-wide text-text">
        <Download className="text-gold opacity-70" size={15} aria-hidden="true" />
        {t('import_title')}
      </h2>
      <p className="mt-3 text-[10px] leading-5 text-muted">{t('import_hint')}</p>
      <div className="mt-4">
        <Button type="button" disabled={!signed_in} onClick={() => dispatch_app({ type: 'wallet_import/open' })}>
          {t('import_open')}
        </Button>
      </div>
    </section>
  )
}
