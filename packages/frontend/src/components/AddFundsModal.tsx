// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, CreditCard, ExternalLink, Wallet } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import { NativeModal, GameWindow, Button } from '@aresrpg/ui'

import { env, type Network } from '../env.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { FundingErrorBoundary } from '../funding/FundingErrorBoundary.tsx'
import { useFundingAnalytics, type FundingMethod } from '../funding/analytics.ts'
import { FUNDING_CUSHION_MIST } from '../funding/near.ts'
import { format_sui, format_token_usd } from '../wallet_amount.ts'
import { useSuiUsd } from '../funding/useSuiUsd.ts'
import { useLocale } from '../i18n/LocaleScope.tsx'
import { WalletSources } from '../wallet/WalletSources.tsx'
import { external_wallet_view } from '../wallet/view.ts'
import { useAppStore } from '../store.ts'
import { capture_analytics } from '../analytics.ts'
import { useFundingCheckout } from '../funding/useFundingCheckout.ts'

import { useCopy } from './useCopy.ts'

const FundingDialog = lazy(() => import('../funding/FundingDialog.tsx'))
const FundingCheckout = lazy(() =>
  import('../funding/FundingCheckout.tsx').then((module) => ({ default: module.FundingCheckout }))
)
export const SUI_FAUCET_URL = 'https://faucet.sui.io/'
export const add_funds_surface = (network: Network): 'faucet' | 'providers' =>
  network === 'testnet' ? 'faucet' : 'providers'
const CARD_PROVIDERS = [
  { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
  { name: 'Transak', url: 'https://global.transak.com/?cryptoCurrencyCode=SUI' },
  { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
] as const
const wallet_text = (copy: AppCopy, key: string): string => copy_text(copy.wallet_legacy)(key)

const WalletAddressBlock = ({
  address,
  compact,
  copy,
  method,
}: Readonly<{ address: string; compact?: boolean; copy: AppCopy; method: FundingMethod }>) => {
  const [copied, copy_value] = useCopy()
  useEffect(() => {
    if (copied) capture_analytics('funding_address_copied', { method })
  }, [copied, method])
  const copy_address = (): void => {
    if (address) copy_value(address)
  }
  return (
    <section>
      {!compact && (
        <>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
            {wallet_text(copy, 'your_address')}
          </h3>
          <p className="mb-3 text-[10px] tracking-wide text-muted">{wallet_text(copy, 'send_sui')}</p>
        </>
      )}
      <Button className="aui-funding-address" disabled={!address} onClick={copy_address} type="button">
        <Wallet className="shrink-0 text-gold opacity-60" size={14} />
        <span className="flex-1 select-all break-all text-left font-mono text-[11px] tracking-wide text-gold">
          {address || copy.sign_in_to_play}
        </span>
        {copied ? (
          <Check className="shrink-0 text-emerald-400 opacity-80" size={14} />
        ) : (
          <Copy className="shrink-0 opacity-40 transition-opacity group-hover:opacity-80" size={14} />
        )}
      </Button>
    </section>
  )
}

type FundingProps = Readonly<{ address: string; copy: AppCopy }>
const CardFunding = ({ copy, locked }: Readonly<{ copy: AppCopy; locked: boolean }>) => (
  <section className="space-y-3 border-t border-border pt-4">
    <h3 className="flex items-center gap-2 text-xs text-muted">
      <CreditCard size={16} />
      {wallet_text(copy, 'funding_method_card')}
    </h3>
    <div className="grid gap-2 sm:grid-cols-3">
      {CARD_PROVIDERS.map((provider) => (
        <a
          className="aui-funding-card"
          key={provider.name}
          href={locked ? undefined : provider.url}
          aria-disabled={locked}
          tabIndex={locked ? -1 : undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => capture_analytics('funding_method_viewed', { method: 'card' })}
        >
          {provider.name}
          <ExternalLink size={12} />
        </a>
      ))}
    </div>
  </section>
)

const FaucetFunding = ({ address, copy }: FundingProps) => (
  <section className="space-y-4 text-xs text-muted" data-testnet-faucet="">
    <p>{wallet_text(copy, 'testnet_faucet_body')}</p>
    <WalletAddressBlock address={address} copy={copy} method="faucet" compact />
    <a className="btn-outline block p-3 text-center" href={SUI_FAUCET_URL} target="_blank" rel="noopener noreferrer">
      {wallet_text(copy, 'testnet_faucet_action')}
    </a>
  </section>
)

const FundingForm = ({
  address,
  copy,
  cost,
  balance,
  checkout,
  close,
}: FundingProps &
  Readonly<{
    cost: bigint
    balance: bigint | null
    checkout: ReturnType<typeof useFundingCheckout>
    close: () => void
  }>) => {
  const { locked } = checkout
  const wallet = useAppStore((state) => state.external_wallet)
  const price = useSuiUsd(true)
  const locale = useLocale()
  const minimum = cost + FUNDING_CUSHION_MIST
  const delivered = checkout.state.stage === 'success'
  useFundingAnalytics(wallet.session ? 'bridge' : 'direct', env.network)
  return (
    <>
      <WalletAddressBlock address={address} copy={copy} method="direct" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">
          {wallet_text(copy, 'funding_available')}
        </span>
        <span className="flex items-baseline gap-2 font-mono" data-funding-balance="">
          <span className={`text-[15px] font-semibold transition-colors ${delivered ? 'text-gold' : 'text-text'}`}>
            {balance === null ? '—' : `${format_sui(balance)} SUI`}
          </span>
          {balance !== null && (
            <span className="text-xs text-muted">{format_token_usd(balance, 9, price, locale)}</span>
          )}
        </span>
      </div>
      {balance !== null && balance < minimum && (
        <p
          className="rounded border border-gold/25 bg-gold/5 p-3 text-xs leading-relaxed text-gold"
          data-funding-minimum=""
        >
          {wallet_text(copy, cost > 0n ? 'funding_purchase_minimum' : 'funding_minimum').replace(
            '{{amount}}',
            `${format_sui(minimum)} SUI (${format_token_usd(minimum, 9, price, locale)})`
          )}
        </p>
      )}
      <WalletSources wallet={external_wallet_view(wallet)} copy={copy} locked={locked} />
      <Suspense fallback={<p className="text-xs text-muted">{copy.kares_page.loading}</p>}>
        <FundingCheckout address={address} copy={copy} checkout={checkout} price_usd={price} close={close} />
      </Suspense>
      <CardFunding copy={copy} locked={locked} />
    </>
  )
}

export const AddFundsModal = ({
  address,
  copy,
  network = env.network,
  on_close,
  warning,
  cost_mist = 0n,
}: Readonly<{
  address: string | null
  copy: AppCopy
  network?: Network
  on_close: () => void
  warning?: string
  cost_mist?: bigint
}>) => {
  const testnet = network === 'testnet'
  const source = useAppStore((state) => state.external_wallet.session)
  const balance = useAppStore((state) => state.session.sui_balance_mist)
  const recipient = address ?? ''
  const checkout = useFundingCheckout(source, recipient, cost_mist, balance, !testnet)
  const close = on_close
  const title = wallet_text(copy, testnet ? 'testnet_faucet_title' : 'add_funds')
  const content = (
    <GameWindow
      title={title}
      icon={<Wallet />}
      close={close}
      close_label={copy.wallet_close}
      className="aui-funding-window"
    >
      <div className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6" data-add-funds="">
        {warning && (
          <p className="border-l-2 border-gold pl-3 text-xs text-gold" role="alert">
            {warning}
          </p>
        )}
        {testnet ? (
          <FaucetFunding address={recipient} copy={copy} />
        ) : (
          <FundingForm
            key={recipient}
            address={recipient}
            copy={copy}
            cost={cost_mist}
            balance={balance}
            checkout={checkout}
            close={close}
          />
        )}
      </div>
    </GameWindow>
  )
  return (
    <FundingErrorBoundary
      fallback={
        <NativeModal close={on_close} label={title}>
          <div className="border border-border bg-surface p-6" role="alert">
            <p className="text-xs">{wallet_text(copy, 'funding_failed')}</p>
            <WalletAddressBlock address={recipient} copy={copy} method="direct" />
          </div>
        </NativeModal>
      }
    >
      {testnet ? (
        <NativeModal close={close} label={title}>
          {content}
        </NativeModal>
      ) : (
        <Suspense fallback={null}>
          <FundingDialog close={close} label={title}>
            {content}
          </FundingDialog>
        </Suspense>
      )}
    </FundingErrorBoundary>
  )
}
