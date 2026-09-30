// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, ExternalLink, Wallet, ArrowLeftRight, CreditCard } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { NativeModal, GameWindow, Button } from '@aresrpg/ui'

import { env, type Network } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { BridgeFunding, FundingErrorBoundary } from '../funding/BridgeFunding.tsx'

const FundingDialog = lazy(() => import('../funding/FundingDialog.tsx'))

export const SUI_FAUCET_URL = 'https://faucet.sui.io/'
export const add_funds_surface = (network: Network): 'faucet' | 'providers' =>
  network === 'testnet' ? 'faucet' : 'providers'

export const ADD_FUNDS_PAYMENT_METHODS = [
  { key: 'direct', label: 'method_have_sui', desc: 'method_have_sui_desc' },
  { key: 'bridge', label: 'method_swap', desc: 'method_swap_desc' },
  { key: 'card', label: 'method_card', desc: 'method_card_desc' },
] as const

const CARD_PROVIDERS = [
  { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
  { name: 'Transak', url: 'https://global.transak.com/?cryptoCurrencyCode=SUI' },
  { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
] as const

const wallet_text = (copy: AppCopy, key: string): string => {
  const value = copy.wallet_legacy[key]
  return typeof value === 'string' ? value : key
}

const WalletAddressBlock = ({
  address,
  compact,
  copy,
}: Readonly<{ address: string; compact?: boolean; copy: AppCopy }>) => {
  const [copied, set_copied] = useState(false)
  const copy_address = (): void => {
    if (!address) return
    void navigator.clipboard.writeText(address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
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

export const AddFundsModal = ({
  address,
  copy,
  network = env.network,
  on_close,
  warning,
}: Readonly<{ address: string | null; copy: AppCopy; network?: Network; on_close: () => void; warning?: string }>) => {
  const [selected, set_selected] = useState<'direct' | 'bridge' | 'card'>('direct')
  const [bridge_opened, set_bridge_opened] = useState(false)
  const wallet_address = address ?? ''
  const testnet = add_funds_surface(network) === 'faucet'
  const title = wallet_text(copy, testnet ? 'testnet_faucet_title' : 'add_funds')
  const content = (
    <GameWindow
      title={title}
      icon={<Wallet />}
      close={on_close}
      close_label={copy.wallet_close}
      className="aui-funding-window"
    >
      <div className="aui-funding-body">
        {warning && (
          <p className="mb-4 border border-gold/40 p-3 text-xs text-gold" role="alert">
            {warning}
          </p>
        )}
        {testnet ? (
          <section className="aui-funding-faucet space-y-4 text-xs text-muted" data-testnet-faucet="">
            <p>{wallet_text(copy, 'testnet_faucet_body')}</p>
            <WalletAddressBlock address={wallet_address} compact copy={copy} />
            <a
              className="btn-outline flex items-center justify-center gap-2 p-3"
              href={SUI_FAUCET_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              {wallet_text(copy, 'testnet_faucet_action')}
              <ExternalLink size={13} />
            </a>
          </section>
        ) : (
          <>
            <div className="aui-funding-methods" role="group" aria-label={wallet_text(copy, 'how_to_pay')}>
              {ADD_FUNDS_PAYMENT_METHODS.map((method) => (
                <Button
                  className="aui-funding-choice"
                  data-method={method.key}
                  aria-pressed={selected === method.key}
                  key={method.key}
                  onClick={() => {
                    set_selected(method.key)
                    if (method.key === 'bridge') set_bridge_opened(true)
                  }}
                  type="button"
                >
                  <span className="aui-funding-method-icon" aria-hidden="true">
                    {{ direct: <Wallet />, bridge: <ArrowLeftRight />, card: <CreditCard /> }[method.key]}
                  </span>
                  <span className="aui-funding-method-title">{wallet_text(copy, method.label)}</span>
                  <span className="aui-funding-method-description">{wallet_text(copy, method.desc)}</span>
                </Button>
              ))}
            </div>
            <section className="aui-funding-detail" hidden={selected !== 'direct'}>
              <WalletAddressBlock address={wallet_address} copy={copy} />
            </section>
            <section className="aui-funding-detail" hidden={selected !== 'bridge'}>
              {bridge_opened && address ? (
                <BridgeFunding address={address} copy={copy} key={address} />
              ) : (
                <p className="aui-funding-connect">{copy.sign_in_to_play}</p>
              )}
            </section>
            <section hidden={selected !== 'card'} className="aui-funding-detail space-y-4">
              <p className="text-xs leading-relaxed text-muted">{wallet_text(copy, 'steps_card')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {CARD_PROVIDERS.map((provider) => (
                  <a
                    className="flex items-center justify-between border border-border bg-bg/50 p-3 text-xs text-text hover:border-gold/40"
                    href={provider.url}
                    key={provider.name}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {provider.name}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </div>
              <WalletAddressBlock address={wallet_address} compact copy={copy} />
            </section>
          </>
        )}
      </div>
    </GameWindow>
  )
  return (
    <FundingErrorBoundary
      fallback={
        <NativeModal
          close={on_close}
          label={title}
          className="modal-padded open:flex open:items-center open:justify-center bg-black/70"
        >
          <div className="max-w-lg border border-border bg-surface p-5 text-text" role="alert">
            <p className="mb-4 text-xs text-muted">{wallet_text(copy, 'bridge_error')}</p>
            <WalletAddressBlock address={wallet_address} copy={copy} />
          </div>
        </NativeModal>
      }
    >
      {testnet ? (
        <NativeModal close={on_close} label={title} className="aui-modal-scrim">
          {content}
        </NativeModal>
      ) : (
        <Suspense fallback={null}>
          <FundingDialog close={on_close} label={title}>
            {content}
          </FundingDialog>
        </Suspense>
      )}
    </FundingErrorBoundary>
  )
}
