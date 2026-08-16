// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { registerEnokiWallets } from '@mysten/enoki'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { isValidSuiAddress } from '@mysten/sui/utils'
import {
  getWallets,
  isWalletWithRequiredFeatureSet,
  SuiSignPersonalMessage,
  SuiSignTransaction,
  type SuiSignPersonalMessageFeature,
  type SuiSignTransactionFeature,
  type Wallet,
} from '@mysten/wallet-standard'

import PINS from '../../../pins.json' with { type: 'json' }

import { character_claim_id, character_id } from './character.ts'
import { gas_mist_from_receipt } from './gas.ts'
import { SDK, type SuiTransport } from './client.ts'
import type { SeedAdminConfig, SeedAdminSession } from './seed_admin.ts'
import type { SeedContent } from './seed.ts'
import { sui_transfer_ptb } from './sui_transfer.ts'
import type { MarketplaceRoyalty } from './marketplace_admin.ts'

export type AuthSession = Readonly<{
  address: string
  wallet_name: string
  sign_personal_message: (message: Uint8Array) => Promise<{ bytes: string; signature: string }>
  read_sui_balance: () => Promise<bigint>
  gas_spent_24h: () => bigint
  derive_character_id: (name: string) => string
  is_character_name_claimed: (name: string) => Promise<boolean>
  resolve_suins_address: (name: string) => Promise<string | null>
  estimate_sui_transfer: (recipient: string, amount_mist: bigint, drain: boolean) => Promise<bigint>
  send_sui: (recipient: string, amount_mist: bigint, drain: boolean) => Promise<Readonly<{ digest: string | null }>>
  create_seed_admin: (content: SeedContent, config: SeedAdminConfig) => Promise<SeedAdminSession>
  read_marketplace_royalties: () => Promise<readonly MarketplaceRoyalty[]>
  claim_marketplace_royalties: () => Promise<
    Readonly<{
      digest: string
      amount_mist: bigint
      policies: readonly ('item' | 'character')[]
    }>
  >
  disconnect: () => Promise<void>
}>

export type AuthWallet = Readonly<{
  name: string
  connect: () => Promise<AuthSession>
}>

export type BrowserAuthOptions = Readonly<{
  enoki_api_key: string
  google_client_id: string
  graphql_url: string
  network: 'testnet' | 'mainnet'
  redirect_url: string
}>
export type WalletAuthOptions = Pick<BrowserAuthOptions, 'graphql_url' | 'network'>

const installed_wallets = (): readonly Wallet[] =>
  getWallets()
    .get()
    .filter(
      (wallet) =>
        !('enoki:getSession' in wallet.features) &&
        isWalletWithRequiredFeatureSet(wallet, ['sui:signPersonalMessage', 'sui:signTransaction'])
    )
const connect_wallet = async (
  wallet: Wallet,
  network: BrowserAuthOptions['network'],
  client: SuiGraphQLClient,
  silent = false
): Promise<AuthSession> => {
  const connect_feature = wallet.features['standard:connect'] as {
    connect: (options?: { silent?: boolean }) => Promise<{ accounts: readonly { address: string }[] }>
  }
  const { accounts } = await connect_feature.connect(silent ? { silent: true } : undefined)
  const [account] = accounts
  if (!account) throw new Error(`${wallet.name} returned no account`)
  const sign_feature = (wallet.features as unknown as SuiSignPersonalMessageFeature)[SuiSignPersonalMessage]
  if (!sign_feature) throw new Error(`${wallet.name} cannot sign the login proof`)
  type SignInput = Parameters<typeof sign_feature.signPersonalMessage>[0]
  const sign_transaction_feature = (wallet.features as unknown as SuiSignTransactionFeature)[SuiSignTransaction]
  if (!sign_transaction_feature) throw new Error(`${wallet.name} cannot sign SUI transfers`)
  type SignTransactionInput = Parameters<typeof sign_transaction_feature.signTransaction>[0]
  const disconnect = wallet.features['standard:disconnect'] as { disconnect?: () => Promise<void> } | undefined
  const sdk = SDK({
    client: client as unknown as SuiTransport,
    address: account.address,
    network,
    sign_transaction: (transaction) =>
      sign_transaction_feature.signTransaction({
        transaction,
        account: account as SignTransactionInput['account'],
        chain: `sui:${network}`,
      }),
  })
  const registry_pin = (PINS as Record<string, { name_registry?: { id?: string | null } }>)[network]?.name_registry?.id
  const require_registry = (): string => {
    if (!registry_pin) throw new Error('The character registry is not published on this network')
    return registry_pin
  }
  return Object.freeze({
    address: account.address,
    wallet_name: wallet.name,
    sign_personal_message: (message: Uint8Array) =>
      sign_feature.signPersonalMessage({
        message,
        account: account as SignInput['account'],
        chain: `sui:${network}`,
      }),
    read_sui_balance: sdk.read_sui_balance,
    gas_spent_24h: sdk.gas_spent_24h,
    derive_character_id: (name: string) => character_id(require_registry(), name),
    is_character_name_claimed: async (name: string) => {
      const claim_id = character_claim_id(require_registry(), name)
      const { objects } = await client.core.getObjects({ objectIds: [claim_id] })
      return objects.some((object) => !(object instanceof Error) && object.objectId === claim_id)
    },
    resolve_suins_address: async (name: string) => {
      const { address } = await client.core.resolveNameServiceAddress({ name: canonical_suins_name(name) })
      return address
    },
    estimate_sui_transfer: async (recipient: string, amount_mist: bigint, drain: boolean) => {
      if (!isValidSuiAddress(recipient)) throw new Error('Enter a valid Sui address')
      if (amount_mist <= 0n) throw new Error('The SUI amount must be positive')
      const transaction = sui_transfer_ptb({
        sender: account.address,
        recipient,
        amount_mist: drain ? null : amount_mist,
      })
      const simulation = await sdk.simulate(transaction)
      if (simulation.$kind === 'FailedTransaction') throw new Error('The transfer cannot be built')
      return gas_mist_from_receipt(simulation) ?? 2_000_000n
    },
    send_sui: async (recipient: string, amount_mist: bigint, drain: boolean) => {
      if (!isValidSuiAddress(recipient)) throw new Error('Enter a valid Sui address')
      if (amount_mist <= 0n) throw new Error('The SUI amount must be positive')
      const transaction = sui_transfer_ptb({
        sender: account.address,
        recipient,
        amount_mist: drain ? null : amount_mist,
      })
      const receipt = await sdk.execute(transaction)
      if (receipt.$kind === 'FailedTransaction') throw new Error('The SUI transfer failed on-chain')
      return Object.freeze({
        digest: receipt.Transaction?.digest ?? receipt.digest ?? null,
      })
    },
    create_seed_admin: async (content, config) => {
      const { create_seed_admin } = await import('./seed_admin.ts')
      return create_seed_admin({ sdk, content, config })
    },
    read_marketplace_royalties: async () => {
      const { read_marketplace_royalties } = await import('./marketplace_admin.ts')
      return read_marketplace_royalties(sdk, account.address)
    },
    claim_marketplace_royalties: async () => {
      const { claim_marketplace_royalties } = await import('./marketplace_admin.ts')
      return claim_marketplace_royalties(sdk, account.address)
    },
    disconnect: async () => void (await disconnect?.disconnect?.()),
  })
}

export const create_browser_auth = (options: BrowserAuthOptions) => {
  const client = new SuiGraphQLClient({ network: options.network, url: options.graphql_url })
  const registration = registerEnokiWallets({
    apiKey: options.enoki_api_key,
    providers: { google: { clientId: options.google_client_id, redirectUrl: options.redirect_url } },
    clients: [client],
    getCurrentNetwork: () => options.network,
  })
  const { google } = registration.wallets
  const wrap = (wallet: Wallet): AuthWallet =>
    Object.freeze({ name: wallet.name, connect: () => connect_wallet(wallet, options.network, client) })

  return Object.freeze({
    connect_google: () => {
      if (!google) throw new Error('Google login is unavailable')
      return connect_wallet(google, options.network, client)
    },
    wallets: (): readonly AuthWallet[] => installed_wallets().map(wrap),
    restore: async (wallet_name: string): Promise<AuthSession | null> => {
      const wallet = [google, ...getWallets().get()].find((candidate) => candidate?.name === wallet_name)
      return wallet ? connect_wallet(wallet, options.network, client, true) : null
    },
    dispose: () => registration.unregister(),
  })
}

export const create_wallet_auth = (options: WalletAuthOptions) => {
  const client = new SuiGraphQLClient({ network: options.network, url: options.graphql_url })
  return Object.freeze({
    wallets: (): readonly AuthWallet[] =>
      installed_wallets().map((wallet) =>
        Object.freeze({ name: wallet.name, connect: () => connect_wallet(wallet, options.network, client) })
      ),
  })
}

export type BrowserAuth = ReturnType<typeof create_browser_auth>

export const canonical_suins_name = (value: string): string => {
  const name = value.trim().toLowerCase()
  if (name.startsWith('@')) return `${name.slice(1)}.sui`
  const subname = /^([^@\s]+)@([^@\s]+)$/.exec(name)
  return subname ? `${subname[1]}.${subname[2]}.sui` : name
}
