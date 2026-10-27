// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { GameWindow, NativeModal, suspend_native_modals } from '@aresrpg/ui'

import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { gift_funding_text } from '../../src/airdrop/GiftClaimNotice.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, initialize_app_store, read_app_state, useAppStore, observe_app } from '../../src/store.ts'
import type { AuthSession } from '../../src/auth.ts'
import { crypto_session, type CryptoWalletSession } from '../../src/wallet/external_session.ts'
import { ExternalWalletHost } from '../../src/wallet/ExternalWalletHost.tsx'
const FundingDialog = lazy(() => import('../../src/funding/FundingDialog.tsx'))
import { WalletControl } from '../../src/wallet/WalletControl.tsx'
import { external_wallet_view } from '../../src/wallet/view.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')
const params = new URLSearchParams(location.search)
window.addEventListener('funding-balances-ready', () => params.delete('balances-fail'))
const recipient = `0x${'11'.repeat(32)}`
initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: { address: recipient, wallet_name: 'Google', identity: 'zklogin' } as AuthSession,
})
dispatch_app({
  type: 'wallet/refreshed',
  balance_mist: params.has('funded') ? 30_040_000_000n : 0n,
  kares_balance: null,
  gas_spent_mist: 0n,
})
const sent = (address: string, amount: bigint): string => {
  document.documentElement.dataset.payment = JSON.stringify({ address, amount: String(amount) })
  document.documentElement.dataset.paymentCount = String(Number(document.documentElement.dataset.paymentCount ?? 0) + 1)
  if (params.has('reject')) throw Object.assign(new Error('Rejected'), { code: 4001 })
  if (params.has('uncertain')) throw new Error('Connection lost after submission')
  if (params.has('disconnect')) dispatch_app({ type: 'external_wallet/invalidated', session: source })
  return 'fixture-transaction'
}
const common = {
  wallet_name: 'Slush',
  disconnect: async () => {
    if (params.has('slow-disconnect'))
      await new Promise<void>((resolve) =>
        window.addEventListener('release-wallet-disconnect', () => resolve(), { once: true })
      )
  },
  is_transaction_idle: () => true,
}
const source: AuthSession | CryptoWalletSession = params.has('crypto')
  ? {
      ...common,
      address: `0x${'33'.repeat(20)}`,
      family: params.has('solana') ? 'solana' : 'evm',
      balance: async () => 100_000_000n,
      balances: async (assets) => {
        if (params.has('balances-fail')) throw new Error('RPC unavailable')
        return {
          assets: assets
            .filter((asset) => asset.blockchain === 'base')
            .map((asset) => ({
              ...asset,
              balance: params.has('empty') || asset.symbol === 'ZERO' ? 0n : 100_000_000n,
            })),
          failed: false,
        }
      },
      send: async (payment, submitting) => {
        submitting()
        return sent(payment.recipient, payment.amount)
      },
    }
  : ({
      ...common,
      address: `0x${'33'.repeat(32)}`,
      identity: 'wallet',
      estimate_sui_transfer: async () => {
        if (params.has('slow'))
          await new Promise<void>((resolve) =>
            window.addEventListener('release-estimate', () => resolve(), { once: true })
          )
        document.documentElement.dataset.preflight = 'finished'
        return 1_000_000n
      },
      read_sui_balance: async () => 10_000_000_000n,
      send_sui: async (address: string, amount: bigint) => ({ digest: sent(address, amount) }),
    } as unknown as AuthSession)
if (params.has('live')) {
  const stop = observe_app(['external_wallet'])
  window.addEventListener('pagehide', stop, { once: true })
} else
  dispatch_app({
    type: 'external_wallet/ready',
    remembered: null,
    wallets: [
      {
        name: 'Slush',
        authorize: async () => [source.address],
        connect: async () => source,
        disconnect: async () => {},
      },
    ],
  })
if (params.has('connected'))
  dispatch_app({
    type: 'external_wallet/connected',
    sequence: read_app_state().external_wallet.sequence,
    session: source,
  })

const VendorWallet = ({ close }: Readonly<{ close: () => void }>) => {
  useEffect(() => suspend_native_modals(document), [])
  return createPortal(
    <div role="dialog" aria-label="Provider wallet" className="fixed inset-0 z-[2000] bg-surface p-10">
      <input aria-label="Wallet search" />
      <button type="button" onClick={close}>
        Close provider
      </button>
    </div>,
    document.body
  )
}

const TestCryptoConnector = () => {
  const wallet = useAppStore((state) => state.external_wallet)
  useEffect(() => {
    const request = wallet.connector_request
    if (!params.has('intent') || !request) return
    dispatch_app({
      type: 'external_wallet/connected',
      sequence: request,
      session: {
        ...source,
        family: 'evm',
        address: `0x${'44'.repeat(20)}`,
      } as CryptoWalletSession,
    })
  }, [wallet.connector_request])
  return <output data-selected-family={crypto_session(wallet.session)?.family ?? ''} />
}
const ConnectorHost = params.has('intent') ? TestCryptoConnector : ExternalWalletHost

const Fixture = () => {
  const [open, set_open] = useState(true)
  const [vendor_open, set_vendor_open] = useState(false)
  const wallet = useAppStore((state) => state.external_wallet)
  const { request, sequence } = wallet
  useEffect(() => {
    if (params.has('live')) return
    if (request?.kind === 'disconnect') {
      void request.session?.disconnect().then(() => dispatch_app({ type: 'external_wallet/finished', sequence }))
    }
    if (request?.kind === 'authorize')
      dispatch_app({ type: 'external_wallet/accounts', sequence, accounts: [source.address] })
    if (request?.kind === 'connect') dispatch_app({ type: 'external_wallet/connected', sequence, session: source })
  }, [request, sequence])

  return (
    <>
      <ConnectorHost />
      {vendor_open && <VendorWallet close={() => set_vendor_open(false)} />}
      <button type="button" onClick={() => set_open(true)}>
        Open funding
      </button>
      {params.has('underlying') && (
        <NativeModal label="Original action" close={() => {}}>
          <input aria-label="Character name" defaultValue="Preserved name" />
        </NativeModal>
      )}
      {open &&
        (params.has('picker') ? (
          <Suspense fallback={null}>
            <FundingDialog close={() => set_open(false)} label="Add Funds">
              <GameWindow
                title="Add Funds"
                close={() => set_open(false)}
                close_label="Close"
                className="aui-funding-window"
              >
                <div className="p-6">
                  <WalletControl wallet={external_wallet_view(wallet)} copy={copy.kares_page} />
                  <button type="button" onClick={() => set_vendor_open(true)}>
                    Open provider
                  </button>
                </div>
              </GameWindow>
            </FundingDialog>
          </Suspense>
        ) : (
          <AddFundsModal
            address={recipient}
            copy={copy}
            cost_mist={params.has('funded') || params.has('fees') ? 0n : 1_000_000_000n}
            network={params.has('testnet') ? 'testnet' : 'mainnet'}
            warning={
              params.has('warning')
                ? 'Add SUI to collect your gift.'
                : gift_funding_text(copy, read_app_state().distribution, read_app_state().session)
            }
            on_close={() => set_open(false)}
          />
        ))}
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
)
