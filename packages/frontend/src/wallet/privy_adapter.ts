// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { BaseConnectedEthereumWallet, BaseConnectedSolanaWallet } from '@privy-io/react-auth'

import type { CryptoWalletSession } from './external_session.ts'
import type { WalletChoice } from './model.ts'

// Privy declares disconnect as void, but its Solana connector returns a completion promise.
export type PrivySourceWallet = (
  Omit<BaseConnectedEthereumWallet, 'disconnect'> | Omit<BaseConnectedSolanaWallet, 'disconnect'>
) &
  Readonly<{ disconnect: () => void | Promise<void> }>

/** Closing Privy's chooser has no onError callback. Only a shown, unselected prompt is cancellation. */
export const create_privy_prompt = () => {
  let pending: Readonly<{ sequence: number; opened: boolean; selected: boolean }> | null = null
  return {
    begin: (sequence: number): boolean => {
      if (pending?.sequence === sequence) return false
      pending = { sequence, opened: false, selected: false }
      return true
    },
    selected: (sequence: number): void => {
      if (pending?.sequence === sequence) pending = { ...pending, selected: true }
    },
    changed: (sequence: number, open: boolean): boolean => {
      if (pending?.sequence !== sequence) return false
      if (open) {
        pending = { ...pending, opened: true }
        return false
      }
      const cancelled = pending.opened && !pending.selected
      if (cancelled) pending = null
      return cancelled
    },
  }
}

/** Privy can return fresh wrappers for unchanged accounts. Observe provider/account deltas,
 * while retaining actual provider replacements and copied addresses for account switches. */
export const create_privy_discovery = () => {
  let previous: readonly Readonly<{ provider: unknown; address: string }>[] | null = null
  return (wallets: readonly Readonly<PrivySourceWallet>[]): readonly WalletChoice<CryptoWalletSession>[] | null => {
    const snapshot = wallets.map((wallet) => ({
      provider: wallet.type === 'ethereum' ? wallet : wallet.provider.standardWallet,
      address: wallet.address,
    }))
    if (
      previous &&
      snapshot.length === previous.length &&
      snapshot.every(
        (entry, index) => entry.provider === previous![index].provider && entry.address === previous![index].address
      )
    )
      return null
    previous = snapshot
    return privy_wallet_choices(wallets)
  }
}

export const privy_wallet_choice = (wallet: Readonly<PrivySourceWallet>): WalletChoice<CryptoWalletSession> => {
  const family = wallet.type === 'ethereum' ? 'evm' : 'solana'
  const name = `${wallet.meta.name} · ${family === 'evm' ? 'EVM' : 'Solana'}`
  const disconnect = async (): Promise<void> => {
    await wallet.disconnect()
  }
  return {
    name,
    family,
    disconnect,
    authorize: async () => ((await wallet.isConnected()) ? [wallet.address] : []),
    connect: async (address) => {
      if (address !== wallet.address || !(await wallet.isConnected())) throw new Error('funding_source_changed')
      const adapter =
        wallet.type === 'ethereum'
          ? await import('./evm_funding.ts').then(({ evm_balance, evm_balances, evm_send }) => ({
              balance: evm_balance.bind(null, wallet),
              balances: evm_balances.bind(null, wallet),
              send: evm_send.bind(null, wallet),
            }))
          : await import('./solana_funding.ts').then(({ solana_balance, solana_balances, solana_send }) => ({
              balance: solana_balance.bind(null, wallet),
              balances: solana_balances.bind(null, wallet),
              send: solana_send.bind(null, wallet),
            }))
      let busy = false
      return {
        address,
        wallet_name: name,
        family,
        disconnect,
        balance: adapter.balance,
        balances: adapter.balances,
        is_transaction_idle: () => !busy,
        send: async (payment, submitting) => {
          if (busy) throw new Error('funding_pending')
          busy = true
          try {
            return await adapter.send(payment, submitting)
          } finally {
            busy = false
          }
        },
      }
    },
  }
}

/** A provider can authorize several accounts; each remains selectable through the shared owner. */
export const privy_wallet_choices = (
  wallets: readonly Readonly<PrivySourceWallet>[]
): readonly WalletChoice<CryptoWalletSession>[] => {
  const choices = wallets.map(privy_wallet_choice)
  return [...new Set(choices.map(({ name }) => name))].map((name) => {
    const providers = choices.filter((choice) => choice.name === name)
    return {
      name,
      family: providers[0].family,
      authorize: async () => (await Promise.all(providers.map((provider) => provider.authorize(true)))).flat(),
      connect: async (address) => {
        const matches = await Promise.all(
          providers.map(async (provider) => ((await provider.authorize(true)).includes(address) ? provider : null))
        )
        const provider = matches.find((entry) => entry !== null)
        if (!provider) throw new Error('funding_source_changed')
        return provider.connect(address)
      },
      disconnect: async () => {
        await Promise.all(providers.map((provider) => provider.disconnect()))
      },
    }
  })
}
