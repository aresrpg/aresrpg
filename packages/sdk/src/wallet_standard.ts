// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Transaction } from '@mysten/sui/transactions'
import {
  getWallets,
  isWalletWithRequiredFeatureSet,
  SuiSignPersonalMessage,
  SuiSignTransaction,
  type SuiSignPersonalMessageFeature,
  type SuiSignTransactionFeature,
  type Wallet,
  type WalletAccount,
} from '@mysten/wallet-standard'

import type { SdkNetwork } from './client.ts'

export const installed_wallets = (): readonly Wallet[] =>
  getWallets()
    .get()
    .filter(
      (wallet) =>
        !('enoki:getSession' in wallet.features) &&
        isWalletWithRequiredFeatureSet(wallet, ['sui:signPersonalMessage', 'sui:signTransaction'])
    )

export const request_wallet_accounts = async (wallet: Wallet, silent = false): Promise<readonly WalletAccount[]> => {
  const feature = wallet.features['standard:connect'] as {
    connect: (options?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }>
  }
  const { accounts } = await feature.connect(silent ? { silent: true } : undefined)
  if (!accounts.length) throw new Error(`${wallet.name} returned no account`)
  return accounts
}

export const on_wallets_changed = (listener: () => void): (() => void) => {
  const wallets = getWallets()
  const stop_register = wallets.on('register', listener)
  const stop_unregister = wallets.on('unregister', listener)
  return () => {
    stop_register()
    stop_unregister()
  }
}

/** One Wallet Standard adapter shared by finance-only and authenticated game sessions. */
export const create_wallet_binding = (wallet: Wallet, account: WalletAccount, network: SdkNetwork) => {
  const personal = (wallet.features as unknown as SuiSignPersonalMessageFeature)[SuiSignPersonalMessage]
  const signing = (wallet.features as unknown as SuiSignTransactionFeature)[SuiSignTransaction]
  if (!personal || !signing) throw new Error(`${wallet.name} cannot sign Sui transactions and messages`)
  const disconnect = wallet.features['standard:disconnect'] as { disconnect?: () => Promise<void> } | undefined
  const events = wallet.features['standard:events'] as {
    on: (
      event: 'change',
      listener: (properties: Readonly<{ accounts?: readonly WalletAccount[] }>) => void
    ) => () => void
  }
  let invalidated_listener: (() => void) | null = null
  const stop_events = events.on('change', ({ accounts }) => {
    if (accounts && !accounts.some(({ address }) => address === account.address)) invalidated_listener?.()
  })
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    stop_events()
    invalidated_listener = null
  }
  const require_active = (): void => {
    if (disposed) throw new Error('This wallet session is disconnected')
  }
  return Object.freeze({
    sign_transaction: (transaction: Transaction) => {
      require_active()
      return signing.signTransaction({
        transaction,
        account: account as Parameters<typeof signing.signTransaction>[0]['account'],
        chain: `sui:${network}`,
      })
    },
    sign_personal_message: (message: Uint8Array) => {
      require_active()
      return personal.signPersonalMessage({
        message,
        account: account as Parameters<typeof personal.signPersonalMessage>[0]['account'],
        chain: `sui:${network}`,
      })
    },
    on_invalidated: (listener: () => void) => {
      invalidated_listener = listener
      return () => {
        if (invalidated_listener === listener) invalidated_listener = null
      }
    },
    dispose,
    disconnect: async () => {
      dispose()
      await disconnect?.disconnect?.()
    },
  })
}

export const selectable_wallet = <Session>(
  wallet: Wallet,
  connect: (wallet: Wallet, account: WalletAccount) => Session
) => {
  let accounts: readonly WalletAccount[] | null = null
  const feature = wallet.features['standard:disconnect'] as { disconnect?: () => Promise<void> } | undefined
  return Object.freeze({
    name: wallet.name,
    authorize: async (silent = false) => {
      accounts = await request_wallet_accounts(wallet, silent)
      return Object.freeze(accounts.map(({ address }) => address))
    },
    connect: async (address: string): Promise<Session> => {
      const account = accounts?.find((candidate) => candidate.address === address)
      if (!account) throw new Error(`${address} is not authorized in ${wallet.name}`)
      return connect(wallet, account)
    },
    disconnect: async () => {
      accounts = null
      await feature?.disconnect?.()
    },
  })
}
