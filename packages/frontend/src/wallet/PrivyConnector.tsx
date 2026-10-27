// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { PrivyProvider, useConnectWallet, useWallets, useModalStatus } from '@privy-io/react-auth'
import { toSolanaWalletConnectors, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana'
import { useEffect, useMemo, useState } from 'react'
import { suspend_native_modals } from '@aresrpg/ui'

import { env } from '../env.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'

import {
  create_privy_discovery,
  create_privy_prompt,
  privy_wallet_choice,
  privy_wallet_choices,
  type PrivySourceWallet,
} from './privy_adapter.ts'

const Connector = () => {
  const [discover] = useState(create_privy_discovery)
  const request = useAppStore((state) => state.external_wallet.connector_request)
  const [prompt] = useState(create_privy_prompt)
  const { wallets, ready } = useWallets()
  const solana = useSolanaWallets()
  const { isOpen } = useModalStatus()
  const fail = (error: string): void => {
    const active = read_app_state().external_wallet.connector_request
    if (active !== null) dispatch_app({ type: 'external_wallet/failed', sequence: active, error })
  }
  const { connectWallet: connect_wallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      const active = read_app_state().external_wallet.connector_request
      if (active === null) return
      const choice = privy_wallet_choice(wallet)
      prompt.selected(active)
      void choice
        .connect(wallet.address)
        .then((session) => {
          if (read_app_state().external_wallet.connector_request !== active) return
          const existing = read_app_state().external_wallet.wallets.filter(
            (entry) => entry.family && entry.name !== choice.name
          )
          dispatch_app({
            type: 'external_wallet/crypto_ready',
            wallets: [...existing, choice] as ReturnType<typeof privy_wallet_choices>,
          })
          dispatch_app({ type: 'external_wallet/connected', sequence: active, session })
        })
        .catch((error: unknown) => {
          console.error('Funding wallet connection failed', error)
          dispatch_app({
            type: 'external_wallet/failed',
            sequence: active,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    },
    onError: () => fail('funding_connection_cancelled'),
  })
  useEffect(() => (isOpen ? suspend_native_modals(document) : undefined), [isOpen])
  useEffect(() => {
    if (!ready || request === null || !prompt.begin(request)) return
    connect_wallet({ walletChainType: 'ethereum-and-solana' })
  }, [request, ready, connect_wallet, prompt])
  useEffect(() => {
    if (request !== null && prompt.changed(request, isOpen)) dispatch_app({ type: 'external_wallet/cancel' })
  }, [request, isOpen, prompt])
  useEffect(() => {
    if (!ready || !solana.ready) return
    const sources: PrivySourceWallet[] = [
      ...wallets.filter((wallet) => wallet.walletClientType !== 'privy'),
      ...solana.wallets.map((provider): PrivySourceWallet => ({
        type: 'solana',
        address: provider.address,
        provider,
        connectedAt: 0,
        walletClientType: 'unknown',
        connectorType: 'injected',
        imported: false,
        meta: { name: provider.standardWallet.name, id: provider.standardWallet.name },
        isConnected: async () =>
          provider.standardWallet.accounts.some((account) => account.address === provider.address),
        disconnect: () => provider.disconnect(),
      })),
    ]
    const choices = discover(sources)
    if (!choices) return
    dispatch_app({ type: 'external_wallet/crypto_ready', wallets: choices })
    const { session } = read_app_state().external_wallet
    if (session && 'family' in session && !sources.some((source) => source.address === session.address))
      dispatch_app({ type: 'external_wallet/invalidated', session })
  }, [wallets, ready, solana.wallets, solana.ready, discover])
  return null
}

export default function PrivyConnector() {
  const config = useMemo(
    () => ({
      appearance: {
        theme: 'dark' as const,
        accentColor: '#d9af57' as const,
        walletChainType: 'ethereum-and-solana' as const,
      },
      embeddedWallets: { ethereum: { createOnLogin: 'off' as const }, solana: { createOnLogin: 'off' as const } },
      externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
    }),
    []
  )
  return (
    <PrivyProvider appId={env.privy_app_id} config={config}>
      <Connector />
    </PrivyProvider>
  )
}
