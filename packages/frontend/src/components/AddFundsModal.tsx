// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, ChevronDown, Copy, ExternalLink, Wallet, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { AppCopy } from '../i18n/copy.ts'

export const ADD_FUNDS_PAYMENT_METHODS = Object.freeze([
  Object.freeze({
    key: 'paypal',
    label: 'method_paypal',
    desc: 'method_paypal_desc',
    providers: [{ name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' }],
    note: 'paypal_note',
    steps: 'steps_paypal',
  }),
  Object.freeze({
    key: 'card',
    label: 'method_card',
    desc: 'method_card_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Transak', url: 'https://global.transak.com/?cryptoCurrencyCode=SUI' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note: 'card_note',
    steps: 'steps_card',
  }),
  Object.freeze({
    key: 'apple_pay',
    label: 'method_apple_pay',
    desc: 'method_apple_pay_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note: null,
    steps: null,
  }),
  Object.freeze({
    key: 'google_pay',
    label: 'method_google_pay',
    desc: 'method_google_pay_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note: null,
    steps: null,
  }),
  Object.freeze({
    key: 'bank',
    label: 'method_bank',
    desc: 'method_bank_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Transak', url: 'https://global.transak.com/?cryptoCurrencyCode=SUI' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note: 'bank_note',
    steps: null,
  }),
  Object.freeze({
    key: 'swap_crypto',
    label: 'method_swap',
    desc: 'method_swap_desc',
    providers: [{ name: 'Portal Bridge', url: 'https://portalbridge.com/' }],
    note: 'swap_note',
    steps: 'steps_swap',
  }),
  Object.freeze({
    key: 'have_sui',
    label: 'method_have_sui',
    desc: 'method_have_sui_desc',
    providers: [],
    note: null,
    steps: 'steps_wallet',
  }),
])

const EXCHANGES = Object.freeze([
  { name: 'Binance', url: 'https://www.binance.com/' },
  { name: 'Coinbase', url: 'https://www.coinbase.com/' },
  { name: 'KuCoin', url: 'https://www.kucoin.com/' },
  { name: 'Bybit', url: 'https://www.bybit.com/' },
  { name: 'OKX', url: 'https://www.okx.com/' },
  { name: 'Kraken', url: 'https://www.kraken.com/' },
])

const FAQ_KEYS = Object.freeze([
  { question: 'faq_what_is_sui', answer: 'faq_what_is_sui_answer' },
  { question: 'faq_why_sui', answer: 'faq_why_sui_answer' },
  { question: 'faq_legal', answer: 'faq_legal_answer' },
  { question: 'faq_eula', answer: 'faq_eula_answer' },
  { question: 'faq_access', answer: 'faq_access_answer' },
  { question: 'faq_balance', answer: 'faq_balance_answer' },
])

const wallet_text = (copy: AppCopy, key: string): string => {
  const value = copy.wallet_legacy[key]
  return typeof value === 'string' ? value : key
}

const FaqItem = ({
  answer,
  is_last,
  question,
}: Readonly<{ answer: ReactNode; is_last: boolean; question: string }>) => {
  const [open, set_open] = useState(false)
  return (
    <div className={is_last ? '' : 'border-b border-border'}>
      <button
        className="group flex w-full cursor-pointer items-center justify-between p-3"
        onClick={() => set_open(!open)}
        type="button"
      >
        <span className="text-left text-[11px] tracking-wide text-text uppercase">{question}</span>
        <ChevronDown
          className={`ml-2 shrink-0 text-muted opacity-40 transition-all group-hover:opacity-80 ${open ? 'rotate-180' : ''}`}
          size={14}
        />
      </button>
      {open && (
        <div className="p-3 pt-0">
          <p className="text-[10px] leading-relaxed tracking-wide text-muted">{answer}</p>
        </div>
      )}
    </div>
  )
}

const WalletAddressBlock = ({
  address,
  compact,
  copy,
}: Readonly<{ address: string; compact?: boolean; copy: AppCopy }>) => {
  const [copied, set_copied] = useState(false)
  const copy_address = (): void => {
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
      <button
        className="group flex w-full cursor-pointer items-center gap-3 border border-border bg-bg/50 p-3 transition-all hover:border-gold/40"
        onClick={copy_address}
        type="button"
      >
        <Wallet className="shrink-0 text-gold opacity-60" size={14} />
        <span className="flex-1 select-all break-all text-left font-mono text-[11px] tracking-wide text-gold">
          {address}
        </span>
        {copied ? (
          <Check className="shrink-0 text-emerald-400 opacity-80" size={14} />
        ) : (
          <Copy className="shrink-0 opacity-40 transition-opacity group-hover:opacity-80" size={14} />
        )}
      </button>
    </section>
  )
}

const PaymentMethodCard = ({
  address,
  copy,
  expanded,
  method,
  toggle,
}: Readonly<{
  address: string
  copy: AppCopy
  expanded: boolean
  method: (typeof ADD_FUNDS_PAYMENT_METHODS)[number]
  toggle: () => void
}>) => {
  const bridge = method.key === 'swap_crypto'
  return (
    <div className="col-span-1">
      <button
        className={`w-full cursor-pointer border p-3 text-left transition-all ${bridge ? 'border-[#7c5cff]/55 bg-[linear-gradient(135deg,rgba(93,69,220,0.3),rgba(47,189,255,0.14),rgba(18,18,26,0.65))] shadow-[0_0_20px_rgba(93,69,220,0.12)] hover:border-[#55c7ff]/70 hover:shadow-[0_0_24px_rgba(93,69,220,0.2)]' : expanded ? 'border-gold/40 bg-bg/50' : 'border-border bg-bg/50 hover:border-gold/40'}`}
        onClick={toggle}
        type="button"
      >
        <span className="block text-[11px] font-semibold tracking-wide text-text uppercase">
          {wallet_text(copy, method.label)}
        </span>
        <span className="mt-1 block text-[9px] tracking-wide text-muted">{wallet_text(copy, method.desc)}</span>
      </button>
      {expanded && (
        <div className="space-y-3 border border-t-0 border-gold/40 bg-bg/30 p-3">
          {method.key === 'have_sui' ? (
            <WalletAddressBlock address={address} copy={copy} />
          ) : (
            <div className="flex flex-col gap-2">
              {method.providers.map((provider) => (
                <a
                  className="group relative flex cursor-pointer items-center justify-between border border-border bg-bg/50 p-3 transition-all hover:border-gold/40"
                  href={provider.url}
                  key={provider.name}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="text-[11px] font-semibold tracking-wide text-text uppercase transition-colors group-hover:text-gold">
                    {provider.name}
                  </span>
                  <ExternalLink
                    className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-40"
                    size={12}
                  />
                </a>
              ))}
            </div>
          )}
          {method.steps && (
            <p className="text-[10px] leading-relaxed tracking-wide text-muted">{wallet_text(copy, method.steps)}</p>
          )}
          {method.note && (
            <p className="text-[9px] leading-relaxed tracking-wide text-muted opacity-70">
              {wallet_text(copy, method.note)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export const AddFundsModal = ({
  address,
  copy,
  on_close,
}: Readonly<{ address: string; copy: AppCopy; on_close: () => void }>) => {
  const [expanded, set_expanded] = useState<string | null>(null)
  const [show_exchanges, set_show_exchanges] = useState(false)
  const [show_faq, set_show_faq] = useState(true)

  useEffect(() => {
    const handler = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') on_close()
    }
    globalThis.addEventListener('keydown', handler)
    return () => globalThis.removeEventListener('keydown', handler)
  }, [on_close])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={on_close}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col border border-border bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <h2 className="text-[13px] font-semibold tracking-[0.2em] text-gold uppercase">
            {wallet_text(copy, 'add_funds')}
          </h2>
          <button
            aria-label={copy.wallet_close}
            className="cursor-pointer opacity-40 transition-opacity hover:opacity-80"
            onClick={on_close}
            type="button"
          >
            <X className="text-muted" size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section>
            <h3 className="mb-1 text-[11px] font-semibold tracking-[0.2em] text-text uppercase">
              {wallet_text(copy, 'how_to_pay')}
            </h3>
            <p className="text-[10px] tracking-wide text-muted">{wallet_text(copy, 'add_funds_desc')}</p>
          </section>
          <section>
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              {ADD_FUNDS_PAYMENT_METHODS.map((method) => (
                <PaymentMethodCard
                  address={address}
                  copy={copy}
                  expanded={expanded === method.key}
                  key={method.key}
                  method={method}
                  toggle={() => set_expanded((current) => (current === method.key ? null : method.key))}
                />
              ))}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
              {wallet_text(copy, 'your_address')}
            </h3>
            <WalletAddressBlock address={address} compact copy={copy} />
          </section>
          <section>
            <button
              className="group flex w-full cursor-pointer items-center justify-between"
              onClick={() => set_show_exchanges(!show_exchanges)}
              type="button"
            >
              <h3 className="text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
                {wallet_text(copy, 'advanced_exchange')}
              </h3>
              <ChevronDown
                className={`ml-2 shrink-0 text-muted opacity-40 transition-all group-hover:opacity-80 ${show_exchanges ? 'rotate-180' : ''}`}
                size={14}
              />
            </button>
            {show_exchanges && (
              <div className="mt-3 space-y-3">
                <p className="text-[10px] tracking-wide text-muted">{wallet_text(copy, 'withdraw_to_wallet')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {EXCHANGES.map((exchange) => (
                    <a
                      className="group relative cursor-pointer border border-border bg-bg/50 p-3 transition-all hover:border-gold/40"
                      href={exchange.url}
                      key={exchange.name}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <ExternalLink
                        className="absolute top-2 right-2 text-muted opacity-0 transition-opacity group-hover:opacity-40"
                        size={12}
                      />
                      <span className="text-[11px] font-semibold tracking-wide text-text uppercase transition-colors group-hover:text-gold">
                        {exchange.name}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section>
            <button
              className="group flex w-full cursor-pointer items-center justify-between"
              onClick={() => set_show_faq(!show_faq)}
              type="button"
            >
              <h3 className="text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
                {wallet_text(copy, 'faq')}
              </h3>
              <ChevronDown
                className={`ml-2 shrink-0 text-muted opacity-40 transition-all group-hover:opacity-80 ${show_faq ? 'rotate-180' : ''}`}
                size={14}
              />
            </button>
            {show_faq && (
              <div className="mt-3 border border-border">
                {FAQ_KEYS.map((item, index) => (
                  <FaqItem
                    answer={wallet_text(copy, item.answer)}
                    is_last={index === FAQ_KEYS.length - 1}
                    key={item.question}
                    question={wallet_text(copy, item.question)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
