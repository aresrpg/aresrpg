import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { fund_store, close_fund_wallet } from '../core/fund-modal.js'
import { Tooltip } from './hud/Tooltip.jsx'

import './fund-wallet.css'

// "Fund your wallet" onboarding — ported from the AresRPG companion (add_funds_modal.tsx) and
// rebuilt in the house design (Frosted Obsidian glass, ice accent on the active method only, mono
// address/numbers, inline SVG). The flow is METHOD-FIRST — "how would you like to pay?" — each
// method expands to its on-ramp providers, steps and note. No SDK/keys: providers are plain
// external links. The EULA FAQ items from the reference corpus are dropped (this game has neither).

const MOONPAY = { name: 'MoonPay', url: 'https://www.moonpay.com/buy/sui' }
const TRANSAK = {
  name: 'Transak',
  url: 'https://global.transak.com/?cryptoCurrencyCode=SUI',
}
const GUARDARIAN = { name: 'Guardarian', url: 'https://guardarian.com/buy-sui' }
const CHANGENOW = {
  name: 'ChangeNOW',
  url: 'https://changenow.io/exchange/btc/sui',
}

// Method-first picker: how would you like to pay → which providers handle it. `have_sui` resolves
// to the player's address instead of a provider list. MoonPay leads where it's offered.
const PAYMENT_METHODS = [
  {
    key: 'paypal',
    label: 'PayPal',
    desc: 'Pay with your PayPal account',
    providers: [MOONPAY],
    note: 'Available in the US, UK and most of Europe via MoonPay.',
    steps: 'Open the link, choose PayPal at checkout, enter the amount, and SUI lands in your wallet.',
  },
  {
    key: 'card',
    label: 'Credit / Debit Card',
    desc: 'Visa, Mastercard',
    providers: [MOONPAY, TRANSAK, GUARDARIAN],
    note: 'All of these accept Visa and Mastercard.',
    steps: 'Pick a provider, enter your card details, and SUI lands in your wallet in a few minutes.',
  },
  {
    key: 'apple_pay',
    label: 'Apple Pay',
    desc: 'Pay with Face ID or Touch ID',
    providers: [MOONPAY, GUARDARIAN],
  },
  {
    key: 'google_pay',
    label: 'Google Pay',
    desc: 'Pay with your Google account',
    providers: [MOONPAY, GUARDARIAN],
  },
  {
    key: 'bank',
    label: 'Bank Transfer',
    desc: 'SEPA (EU) or ACH (US)',
    providers: [MOONPAY, TRANSAK],
    note: 'Lowest fees (~1%). SEPA for Europe, ACH for the US.',
  },
  {
    key: 'swap',
    label: 'Swap Crypto to SUI',
    desc: 'No account needed. BTC, ETH, USDT, 1400+ coins',
    providers: [CHANGENOW],
    note: 'No KYC for crypto-to-crypto swaps. Powered by ChangeNOW.',
    steps: 'Choose your crypto and amount, paste your wallet address below, then send. SUI arrives in minutes.',
  },
  {
    key: 'have_sui',
    label: 'I already have SUI',
    desc: 'Send from another wallet or an exchange',
    providers: [],
  },
]

const FAQ = [
  {
    q: 'What is SUI?',
    a: 'SUI is the digital currency of the Sui network. Think game credits, except only you control them. Small amounts pay for on-chain actions like minting an extra character.',
  },
  {
    q: 'Who can access my wallet?',
    a: 'Only you. It is derived from your Google sign-in via Sui zkLogin, so nobody, not even we, can move your funds. Keep only what you plan to spend here.',
  },
  {
    q: 'I sent SUI but my balance did not update?',
    a: 'Give it a few seconds to refresh. Double-check you sent to the address above; if it still does not show, ping us on Discord with your transaction ID.',
  },
]

/** @param {{ size?: number, children: React.ReactNode }} props */
const Icon = ({ size = 16, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const ExternalIcon = ({ size = 13 }) => (
  <Icon size={size}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
)

/** @param {{ address: string }} props */
function AddressBlock({ address }) {
  const [copied, set_copied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(address)
    set_copied(true)
    setTimeout(() => set_copied(false), 2000)
  }
  return (
    <Tooltip text="Copy">
      <button type="button" className="fund-address" onClick={copy}>
        <span className="fund-address-text">{address}</span>
        <span className={`fund-address-icon${copied ? ' ok' : ''}`}>
          {copied ? (
            <Icon size={15}>
              <path d="M20 6 9 17l-5-5" />
            </Icon>
          ) : (
            <Icon size={15}>
              <rect width="13" height="13" x="9" y="9" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </Icon>
          )}
        </span>
      </button>
    </Tooltip>
  )
}

/**
 * @param {{ method: (typeof PAYMENT_METHODS)[number], open: boolean, on_toggle: () => void,
 *   address: string }} props
 */
function MethodRow({ method, open, on_toggle, address }) {
  return (
    <div className={`fund-method${open ? ' open' : ''}`}>
      <button type="button" className="fund-method-head" onClick={on_toggle}>
        <span className="fund-method-title">
          <span className="fund-method-name">{method.label}</span>
          <span className="fund-method-desc">{method.desc}</span>
        </span>
        <span className={`fund-method-chev${open ? ' open' : ''}`}>
          <Icon size={14}>
            <path d="m6 9 6 6 6-6" />
          </Icon>
        </span>
      </button>
      {open && (
        <div className="fund-method-body">
          {method.key === 'have_sui' ? (
            <AddressBlock address={address} />
          ) : (
            <div className="fund-providers">
              {method.providers.map((p) => (
                <a key={p.name} className="fund-provider" href={p.url} target="_blank" rel="noopener noreferrer">
                  <span className="fund-provider-name">{p.name}</span>
                  <span className="fund-provider-ext">
                    <ExternalIcon />
                  </span>
                </a>
              ))}
            </div>
          )}
          {method.steps && <p className="fund-steps">{method.steps}</p>}
          {method.note && <p className="fund-note">{method.note}</p>}
        </div>
      )}
    </div>
  )
}

/** @param {{ q: string, a: string, last: boolean }} props */
function FaqRow({ q, a, last }) {
  const [open, set_open] = useState(false)
  return (
    <div className={`fund-faq-item${last ? ' last' : ''}`}>
      <button type="button" className="fund-faq-q" onClick={() => set_open((v) => !v)}>
        <span>{q}</span>
        <span className={`fund-faq-chev${open ? ' open' : ''}`}>
          <Icon size={14}>
            <path d="m6 9 6 6 6-6" />
          </Icon>
        </span>
      </button>
      {open && <p className="fund-faq-a">{a}</p>}
    </div>
  )
}

/** The actual modal content (only mounted when the store has state). */
function FundWalletModal({ state }) {
  const { address, required_sui, balance_sui } = state
  const [open_method, set_open_method] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') close_fund_wallet()
    }
    window.addEventListener('keydown', on_key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', on_key)
      document.body.style.overflow = prev
    }
  }, [])

  return createPortal(
    <div
      className="fund-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close_fund_wallet()
      }}
    >
      <div className="fund-card" role="dialog" aria-modal="true">
        <header className="fund-head">
          <h2 className="fund-title">Fund your wallet</h2>
          <button type="button" className="fund-close" onClick={close_fund_wallet} aria-label="Close">
            <Icon size={16}>
              <path d="M18 6 6 18M6 6l12 12" />
            </Icon>
          </button>
        </header>

        <div className="fund-body">
          {required_sui != null && (
            <div className="fund-need">
              <span>
                You need <b>{required_sui} SUI</b> to create another character
              </span>
              <span className="fund-need-bal">
                balance{' '}
                <b>
                  {balance_sui == null
                    ? '-'
                    : balance_sui.toLocaleString('en-US', {
                        maximumFractionDigits: 3,
                      })}
                </b>{' '}
                SUI
              </span>
            </div>
          )}

          <p className="fund-lead">
            Your wallet was created from your Google sign-in using Sui zkLogin. Only you can access it, not even we can
            move your funds. Add SUI and it arrives in seconds.
          </p>

          <div className="fund-section">
            <div className="fund-label">How would you like to pay?</div>
            <div className="fund-methods">
              {PAYMENT_METHODS.map((method) => (
                <MethodRow
                  key={method.key}
                  method={method}
                  address={address}
                  open={open_method === method.key}
                  on_toggle={() => set_open_method((prev) => (prev === method.key ? null : method.key))}
                />
              ))}
            </div>
          </div>

          <div className="fund-section">
            <div className="fund-label">Your wallet address</div>
            <p className="fund-hint">Already hold SUI elsewhere? Send it here, click to copy.</p>
            <AddressBlock address={address} />
          </div>

          <div className="fund-section">
            <div className="fund-faq">
              {FAQ.map((item, i) => (
                <FaqRow key={item.q} q={item.q} a={item.a} last={i === FAQ.length - 1} />
              ))}
            </div>
          </div>

          <p className="fund-age">All payment providers require you to be 18 or older.</p>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Store-bound gate: renders the modal only while the fund store holds state. */
export function FundWalletGate() {
  const state = useSyncExternalStore(fund_store.subscribe, fund_store.get)
  if (!state?.address) return null
  return <FundWalletModal state={state} />
}
