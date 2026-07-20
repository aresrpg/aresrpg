import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Copy, Check, Wallet, X, ExternalLink, ChevronDown } from 'lucide-react'

const PAYMENT_METHODS = [
  {
    key: 'paypal',
    label_key: 'wallet.method_paypal',
    desc_key: 'wallet.method_paypal_desc',
    providers: [{ name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' }],
    note_key: 'wallet.paypal_note',
    steps_key: 'wallet.steps_paypal',
  },
  {
    key: 'card',
    label_key: 'wallet.method_card',
    desc_key: 'wallet.method_card_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Transak', url: 'https://global.transak.com/?cryptoCurrencyCode=SUI' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note_key: 'wallet.card_note',
    steps_key: 'wallet.steps_card',
  },
  {
    key: 'apple_pay',
    label_key: 'wallet.method_apple_pay',
    desc_key: 'wallet.method_apple_pay_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note_key: null,
    steps_key: null,
  },
  {
    key: 'google_pay',
    label_key: 'wallet.method_google_pay',
    desc_key: 'wallet.method_google_pay_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note_key: null,
    steps_key: null,
  },
  {
    key: 'bank',
    label_key: 'wallet.method_bank',
    desc_key: 'wallet.method_bank_desc',
    providers: [
      { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' },
      { name: 'Transak', url: 'https://global.transak.com/?cryptoCurrencyCode=SUI' },
      { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' },
    ],
    note_key: 'wallet.bank_note',
    steps_key: null,
  },
  {
    key: 'swap_crypto',
    label_key: 'wallet.method_swap',
    desc_key: 'wallet.method_swap_desc',
    providers: [{ name: 'ChangeNOW', url: 'https://changenow.io/exchange/btc/sui' }],
    note_key: 'wallet.swap_note',
    steps_key: 'wallet.steps_swap',
  },
  {
    key: 'have_sui',
    label_key: 'wallet.method_have_sui',
    desc_key: 'wallet.method_have_sui_desc',
    providers: [],
    note_key: null,
    steps_key: 'wallet.steps_wallet',
  },
] as const

const EXCHANGES = [
  { name: 'Binance', url: 'https://www.binance.com/' },
  { name: 'Coinbase', url: 'https://www.coinbase.com/' },
  { name: 'KuCoin', url: 'https://www.kucoin.com/' },
  { name: 'Bybit', url: 'https://www.bybit.com/' },
  { name: 'OKX', url: 'https://www.okx.com/' },
  { name: 'Kraken', url: 'https://www.kraken.com/' },
]

const FAQ_KEYS = [
  { question: 'wallet.faq_what_is_sui', answer: 'wallet.faq_what_is_sui_answer' },
  { question: 'wallet.faq_why_sui', answer: 'wallet.faq_why_sui_answer' },
  { question: 'wallet.faq_legal', answer: 'wallet.faq_legal_answer' },
  { question: 'wallet.faq_eula', answer: 'wallet.faq_eula_answer' },
  { question: 'wallet.faq_access', answer: 'wallet.faq_access_answer' },
  { question: 'wallet.faq_balance', answer: 'wallet.faq_balance_answer' },
] as const

function FaqItem({ question, answer, is_last }: { question: string; answer: ReactNode; is_last: boolean }) {
  const [open, set_open] = useState(false)

  return (
    <div className={is_last ? '' : 'border-b border-border'}>
      <button
        type="button"
        onClick={() => set_open(!open)}
        className="w-full flex items-center justify-between p-3 cursor-pointer group"
      >
        <span className="text-text text-[11px] tracking-wide uppercase text-left">{question}</span>
        <ChevronDown
          size={14}
          className={`text-muted opacity-40 group-hover:opacity-80 transition-all shrink-0 ml-2 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="p-3 pt-0">
          <p className="text-muted text-[10px] tracking-wide leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  )
}

function WalletAddressBlock({ address, compact }: { address: string; compact?: boolean }) {
  const { t } = useTranslation()
  const [copied, set_copied] = useState(false)

  const copy_address = () => {
    navigator.clipboard.writeText(address)
    set_copied(true)
    setTimeout(() => set_copied(false), 2000)
  }

  return (
    <section>
      {!compact && (
        <>
          <h3 className="text-gold text-[11px] tracking-[0.2em] uppercase font-semibold mb-2">
            {t('wallet.your_address')}
          </h3>
          <p className="text-muted text-[10px] tracking-wide mb-3">{t('wallet.send_sui')}</p>
        </>
      )}
      <button
        type="button"
        onClick={copy_address}
        className="w-full border border-border bg-bg/50 p-3 flex items-center gap-3 hover:border-gold/40 transition-all cursor-pointer group"
      >
        <Wallet size={14} className="text-gold opacity-60 shrink-0" />
        <span className="text-gold text-[11px] tracking-wide font-mono flex-1 text-left select-all break-all">
          {address}
        </span>
        {copied ? (
          <Check size={14} className="text-emerald-400 opacity-80 shrink-0" />
        ) : (
          <Copy size={14} className="opacity-40 group-hover:opacity-80 transition-opacity shrink-0" />
        )}
      </button>
    </section>
  )
}

function PaymentMethodCard({
  method,
  is_expanded,
  on_toggle,
  address,
}: {
  method: (typeof PAYMENT_METHODS)[number]
  is_expanded: boolean
  on_toggle: () => void
  address: string
}) {
  const { t } = useTranslation()
  const is_have_sui = method.key === 'have_sui'

  return (
    <div className="col-span-1">
      <button
        type="button"
        onClick={on_toggle}
        className={`w-full border bg-bg/50 p-3 text-left cursor-pointer transition-all ${
          is_expanded ? 'border-gold/40' : 'border-border hover:border-gold/40'
        }`}
      >
        <span className="text-text text-[11px] tracking-wide uppercase font-semibold block">{t(method.label_key)}</span>
        <span className="text-muted text-[9px] tracking-wide mt-1 block">{t(method.desc_key)}</span>
      </button>

      {is_expanded && (
        <div className="border border-t-0 border-gold/40 bg-bg/30 p-3 space-y-3">
          {is_have_sui ? (
            <WalletAddressBlock address={address} />
          ) : (
            <div className="flex flex-col gap-2">
              {method.providers.map((provider) => (
                <a
                  key={provider.name}
                  href={provider.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative border border-border bg-bg/50 p-3 hover:border-gold/40 transition-all cursor-pointer group flex items-center justify-between"
                >
                  <span className="text-text text-[11px] tracking-wide uppercase font-semibold group-hover:text-gold transition-colors">
                    {provider.name}
                  </span>
                  <ExternalLink
                    size={12}
                    className="text-muted opacity-0 group-hover:opacity-40 transition-opacity shrink-0"
                  />
                </a>
              ))}
            </div>
          )}

          {method.steps_key && (
            <p className="text-muted text-[10px] tracking-wide leading-relaxed">{t(method.steps_key)}</p>
          )}

          {method.note_key && (
            <p className="text-muted text-[9px] tracking-wide leading-relaxed opacity-70">{t(method.note_key)}</p>
          )}
        </div>
      )}
    </div>
  )
}

export function AddFundsModal({ address, on_close }: { address: string; on_close: () => void }) {
  const { t } = useTranslation()
  const [expanded, set_expanded] = useState<string | null>(null)
  const [show_exchanges, set_show_exchanges] = useState(false)
  const [show_faq, set_show_faq] = useState(true)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [on_close])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={on_close}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] bg-surface border border-border flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-gold text-[13px] tracking-[0.2em] uppercase font-semibold">{t('wallet.add_funds')}</h2>
          <button
            type="button"
            onClick={on_close}
            className="cursor-pointer opacity-40 hover:opacity-80 transition-opacity"
            aria-label="Close"
          >
            <X size={16} className="text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-6">
          {/* Subtitle */}
          <section>
            <h3 className="text-text text-[11px] tracking-[0.2em] uppercase font-semibold mb-1">
              {t('wallet.how_to_pay')}
            </h3>
            <p className="text-muted text-[10px] tracking-wide">{t('wallet.add_funds_desc')}</p>
          </section>

          {/* Payment Methods Grid */}
          <section>
            <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <PaymentMethodCard
                  key={method.key}
                  method={method}
                  is_expanded={expanded === method.key}
                  on_toggle={() => set_expanded((prev) => (prev === method.key ? null : method.key))}
                  address={address}
                />
              ))}
            </div>
          </section>

          {/* Wallet Address (always visible) */}
          <section>
            <h3 className="text-gold text-[11px] tracking-[0.2em] uppercase font-semibold mb-2">
              {t('wallet.your_address')}
            </h3>
            <WalletAddressBlock address={address} compact />
          </section>

          {/* Advanced: Buy on Exchange */}
          <section>
            <button
              type="button"
              onClick={() => set_show_exchanges(!show_exchanges)}
              className="w-full flex items-center justify-between cursor-pointer group"
            >
              <h3 className="text-gold text-[11px] tracking-[0.2em] uppercase font-semibold">
                {t('wallet.advanced_exchange')}
              </h3>
              <ChevronDown
                size={14}
                className={`text-muted opacity-40 group-hover:opacity-80 transition-all shrink-0 ml-2 ${
                  show_exchanges ? 'rotate-180' : ''
                }`}
              />
            </button>
            {show_exchanges && (
              <div className="mt-3 space-y-3">
                <p className="text-muted text-[10px] tracking-wide">{t('wallet.withdraw_to_wallet')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {EXCHANGES.map((item) => (
                    <a
                      key={item.name}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative border border-border bg-bg/50 p-3 hover:border-gold/40 transition-all cursor-pointer group"
                    >
                      <ExternalLink
                        size={12}
                        className="absolute top-2 right-2 text-muted opacity-0 group-hover:opacity-40 transition-opacity"
                      />
                      <span className="text-text text-[11px] tracking-wide uppercase font-semibold group-hover:text-gold transition-colors">
                        {item.name}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* FAQ */}
          <section>
            <button
              type="button"
              onClick={() => set_show_faq(!show_faq)}
              className="w-full flex items-center justify-between cursor-pointer group"
            >
              <h3 className="text-gold text-[11px] tracking-[0.2em] uppercase font-semibold">{t('wallet.faq')}</h3>
              <ChevronDown
                size={14}
                className={`text-muted opacity-40 group-hover:opacity-80 transition-all shrink-0 ml-2 ${
                  show_faq ? 'rotate-180' : ''
                }`}
              />
            </button>
            {show_faq && (
              <div className="mt-3 border border-border">
                {FAQ_KEYS.map((item, i) => (
                  <FaqItem
                    key={item.question}
                    question={t(item.question)}
                    answer={t(item.answer)}
                    is_last={i === FAQ_KEYS.length - 1}
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
