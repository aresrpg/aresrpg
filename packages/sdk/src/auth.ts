// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { registerEnokiWallets } from '@mysten/enoki'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress } from '@mysten/sui/utils'
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

import PINS from '../../../pins.json' with { type: 'json' }

import { character_claim_id, character_create, character_id, type CharacterCreateInput } from './character.ts'
import { gas_mist_from_receipt } from './gas.ts'
import { SDK, type Pins, type SuiTransport } from './client.ts'
import type { SeedAdminConfig, SeedAdminSession } from './seed_admin.ts'
import type { SeedContent } from './seed.ts'
import type { SeedSessionRecord, SeedSessionStore } from './seed_session.ts'
import { sui_transfer_ptb } from './sui_transfer.ts'
import type { MarketplaceRoyalty } from './marketplace_admin.ts'
import type { AirdropClaim, ShopPurchase } from './shop.ts'
import { receipt_digest, receipt_digest_or_null, type Receipt } from './cache.ts'
import { create_personal_kiosk_runner } from './ptb.ts'
import {
  create_deployment_bootstrap_transaction,
  create_package_publish_transaction,
  create_package_upgrade_transaction,
  DISPLAY_REGISTRY_ID,
  type ContractArtifact,
  type GameDeployment,
} from './deployment_admin.ts'

export type AuthSession = Readonly<{
  address: string
  wallet_name: string
  sign_personal_message: (message: Uint8Array) => Promise<{ bytes: string; signature: string }>
  read_sui_balance: () => Promise<bigint>
  gas_spent_24h: () => bigint
  derive_character_id: (name: string) => string
  is_character_name_claimed: (name: string) => Promise<boolean>
  create_character: (character: CharacterCreateInput) => Promise<Readonly<{ digest: string; character_id: string }>>
  resolve_suins_address: (name: string) => Promise<string | null>
  estimate_sui_transfer: (recipient: string, amount_mist: bigint, drain: boolean) => Promise<bigint>
  send_sui: (recipient: string, amount_mist: bigint, drain: boolean) => Promise<Readonly<{ digest: string | null }>>
  buy_shop_item: (purchase: ShopPurchase) => Promise<Readonly<{ digest: string }>>
  claim_airdrop: (claim: AirdropClaim) => Promise<Readonly<{ digest: string }>>
  create_seed_admin: (content: SeedContent, config: SeedAdminConfig, pins?: Pins) => Promise<SeedAdminSession>
  publish_contract: (artifact: ContractArtifact) => Promise<
    Readonly<{
      receipt: Receipt
    }>
  >
  upgrade_contract: (
    deployment: Readonly<{
      artifact: ContractArtifact
      upgrade_cap: string
    }>
  ) => Promise<Readonly<{ receipt: Receipt }>>
  read_package_upgrade: (upgrade_cap: string) => Promise<Readonly<{ package: string; version: number; policy: number }>>
  bootstrap_deployment?: (deployment: GameDeployment) => Promise<Receipt>
  read_game_version: (version: string) => Promise<number>
  read_game_paused: (version: string) => Promise<boolean>
  set_game_paused: (
    deployment: Readonly<{
      package_id: string
      version: string
      admin_cap: string
      paused: boolean
    }>
  ) => Promise<Readonly<{ digest: string }>>
  read_marketplace_royalties: () => Promise<readonly MarketplaceRoyalty[]>
  claim_marketplace_royalties: () => Promise<
    Readonly<{
      digest: string
      amount_mist: bigint
      policies: readonly ('item' | 'character')[]
    }>
  >
  on_invalidated?: (listener: () => void) => () => void
  disconnect: () => Promise<void>
}>

export type AuthWallet = Readonly<{
  name: string
  connect: () => Promise<AuthSession>
}>

export type SelectableAuthWallet = Readonly<{
  name: string
  authorize: () => Promise<readonly string[]>
  connect: (address: string) => Promise<AuthSession>
  disconnect: () => Promise<void>
}>

export type BrowserAuthOptions = Readonly<{
  enoki_api_key: string
  google_client_id: string
  graphql_url: string
  network: 'testnet' | 'mainnet'
  redirect_url: string
  rpc_url?: string
}>
export type WalletAuthOptions = Pick<BrowserAuthOptions, 'graphql_url' | 'network' | 'rpc_url'>

const installed_wallets = (): readonly Wallet[] =>
  getWallets()
    .get()
    .filter(
      (wallet) =>
        !('enoki:getSession' in wallet.features) &&
        isWalletWithRequiredFeatureSet(wallet, ['sui:signPersonalMessage', 'sui:signTransaction'])
    )

const seed_session_storage_key = (network: string, owner: string): string =>
  `aresrpg_admin_seed_session:${network}:${owner.toLowerCase()}`

/** The browser store for the seed session record — every failure THROWS: this record is the
 *  only recovery channel for a signer holding real SUI and a live capability, so "could not
 *  persist" must stop the ceremony, never warn past it. */
const browser_seed_session_store = (key: string): SeedSessionStore => ({
  read: () => {
    const storage = globalThis.localStorage
    if (!storage) return null
    const source = storage.getItem(key)
    if (!source) return null
    const value = JSON.parse(source) as Partial<SeedSessionRecord>
    if (
      typeof value.secret !== 'string' ||
      typeof value.epoch !== 'string' ||
      typeof value.network !== 'string' ||
      typeof value.owner !== 'string' ||
      typeof value.package !== 'string'
    )
      throw new Error(
        `The stored seed session record at "${key}" is corrupt — an earlier session may be orphaned. ` +
          'Recover it manually before authorizing a new one.'
      )
    return Object.freeze({
      secret: value.secret,
      admin_cap: typeof value.admin_cap === 'string' ? value.admin_cap : null,
      epoch: value.epoch,
      network: value.network,
      owner: value.owner,
      package: value.package,
    })
  },
  write: (record) => {
    const storage = globalThis.localStorage
    if (!storage) throw new Error('No browser storage is available to hold the seed session record.')
    storage.setItem(key, JSON.stringify(record))
  },
  clear: () => {
    const storage = globalThis.localStorage
    if (!storage) return
    storage.removeItem(key)
    if (storage.getItem(key) !== null) throw new Error('The temporary signer record remains present')
  },
})
const request_wallet_accounts = async (wallet: Wallet, silent = false): Promise<readonly WalletAccount[]> => {
  const connect_feature = wallet.features['standard:connect'] as {
    connect: (options?: { silent?: boolean }) => Promise<{ accounts: readonly WalletAccount[] }>
  }
  const { accounts } = await connect_feature.connect(silent ? { silent: true } : undefined)
  if (!accounts.length) throw new Error(`${wallet.name} returned no account`)
  return accounts
}

const create_wallet_session = (
  wallet: Wallet,
  account: WalletAccount,
  network: BrowserAuthOptions['network'],
  client: SuiGraphQLClient,
  resolution_client: SuiGrpcClient
): AuthSession => {
  const sign_feature = (wallet.features as unknown as SuiSignPersonalMessageFeature)[SuiSignPersonalMessage]
  if (!sign_feature) throw new Error(`${wallet.name} cannot sign the login proof`)
  type SignInput = Parameters<typeof sign_feature.signPersonalMessage>[0]
  const sign_transaction_feature = (wallet.features as unknown as SuiSignTransactionFeature)[SuiSignTransaction]
  if (!sign_transaction_feature) throw new Error(`${wallet.name} cannot sign SUI transfers`)
  type SignTransactionInput = Parameters<typeof sign_transaction_feature.signTransaction>[0]
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
  const sign_transaction = (transaction: Transaction) =>
    sign_transaction_feature.signTransaction({
      transaction,
      account: account as SignTransactionInput['account'],
      chain: `sui:${network}`,
    })
  const sdk = SDK({
    client: resolution_client as unknown as SuiTransport,
    address: account.address,
    network,
    sign_transaction,
  })
  const registry_pin = (PINS as Record<string, { name_registry?: { id?: string | null } }>)[network]?.name_registry?.id
  // The found cap is cached for the session (kiosks are for life); an EMPTY answer is never
  // cached — the player whose first purchase creates their kiosk must be found on the next call.
  let kiosk_caps: ReturnType<typeof sdk.get_owned_kiosks> | null = null
  const kiosk_cap = async () => {
    const request = kiosk_caps ?? sdk.get_owned_kiosks(account.address)
    kiosk_caps = request
    try {
      const { kioskOwnerCaps } = await request
      const cap = kioskOwnerCaps.find(({ isPersonal }) => isPersonal) ?? null
      if (!cap) kiosk_caps = null
      return cap
    } catch (error) {
      kiosk_caps = null
      throw error
    }
  }
  const personal_kiosk_action = create_personal_kiosk_runner(kiosk_cap)
  const require_registry = (): string => {
    if (!registry_pin) throw new Error('The character registry is not published on this network')
    return registry_pin
  }
  const read_game_version = async (version: string): Promise<number> => {
    const { objects } = await client.core.getObjects({ objectIds: [version], include: { json: true } })
    const object = objects.find((candidate) => !(candidate instanceof Error) && candidate.objectId === version)
    if (!object || object instanceof Error) throw new Error('The published Version object is unavailable')
    const current_version = Number(object.json?.current_version)
    if (!Number.isSafeInteger(current_version) || current_version < 0)
      throw new Error('The published Version value is invalid')
    return current_version
  }
  const read_package_upgrade = async (
    upgrade_cap: string
  ): Promise<Readonly<{ package: string; version: number; policy: number }>> => {
    const { objects } = await client.core.getObjects({ objectIds: [upgrade_cap], include: { json: true } })
    const capability = objects.find((candidate) => !(candidate instanceof Error) && candidate.objectId === upgrade_cap)
    if (!capability || capability instanceof Error) throw new Error('The package UpgradeCap is unavailable')
    const package_id = capability.json?.package
    const version = Number(capability.json?.version)
    const policy = Number(capability.json?.policy)
    if (typeof package_id !== 'string' || !isValidSuiAddress(package_id))
      throw new Error('The package UpgradeCap has an invalid package ID')
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('The package UpgradeCap has an invalid version')
    if (!Number.isInteger(policy) || policy < 0 || policy > 255)
      throw new Error('The package UpgradeCap has an invalid policy')
    return Object.freeze({ package: package_id, version, policy })
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
    create_character: (character) =>
      personal_kiosk_action(async (kiosk_cap) => {
        const { kiosk_cap: settled_kiosk_cap, ...receipt } = await character_create(sdk, {
          ...character,
          kiosk_cap,
        })
        return Object.freeze({ value: Object.freeze(receipt), kiosk_cap: settled_kiosk_cap })
      }),
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
      const estimate = gas_mist_from_receipt(simulation)
      if (estimate === null) throw new Error('The simulation carried no gas figures — cannot estimate the transfer')
      return estimate
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
      return Object.freeze({ digest: receipt_digest_or_null(receipt) })
    },
    buy_shop_item: async (purchase) => {
      const { buy_shop_item } = await import('./shop.ts')
      return personal_kiosk_action(async (kiosk_cap) => {
        const result = await buy_shop_item(sdk, kiosk_cap, purchase)
        return Object.freeze({
          value: Object.freeze({ digest: result.digest }),
          kiosk_cap: result.kiosk_cap,
        })
      })
    },
    claim_airdrop: async (claim) => {
      const { claim_airdrop } = await import('./shop.ts')
      return personal_kiosk_action(async (kiosk_cap) => {
        const result = await claim_airdrop(sdk, kiosk_cap, claim)
        return Object.freeze({
          value: Object.freeze({ digest: result.digest }),
          kiosk_cap: result.kiosk_cap,
        })
      })
    },
    create_seed_admin: async (content, config, current_pins = sdk.pins) => {
      const { create_seed_admin } = await import('./seed_admin.ts')
      const { create_seed_session } = await import('./seed_session.ts')
      const seed_sdk =
        current_pins === sdk.pins
          ? sdk
          : SDK({
              client: resolution_client as unknown as SuiTransport,
              address: account.address,
              network,
              pins: current_pins,
              sign_transaction,
            })
      const super_session = await create_seed_admin({ sdk: seed_sdk, content, config })
      const package_id = seed_sdk.pins.package
      if (typeof package_id !== 'string' || !package_id)
        throw new Error('The seed session needs a published game package in pins.json')
      let delegated: SeedAdminSession | null = null
      const session = create_seed_session({
        store: browser_seed_session_store(seed_session_storage_key(network, account.address)),
        super_sdk: seed_sdk,
        super_admin_cap: config.admin_cap,
        network,
        owner: account.address,
        package_id,
        build_session_sdk: (keypair) =>
          SDK({
            client: resolution_client as unknown as SuiTransport,
            signer: keypair,
            network,
            pins: seed_sdk.pins,
          }),
      })

      const delegated_session = async (): Promise<SeedAdminSession> => {
        if (delegated) return delegated
        await seed_sdk.hydrate([config.admin_cap])
        const { sdk: session_sdk, admin_cap } = await session.ensure()
        delegated = await create_seed_admin({
          sdk: session_sdk,
          content,
          config: { ...config, admin_cap },
        })
        return delegated
      }

      const release = async (): Promise<void> => {
        await session.release()
        delegated = null
      }

      return Object.freeze({
        refresh: super_session.refresh,
        execute: async (batch) => (await delegated_session()).execute(batch),
        seal: super_session.seal,
        release,
      })
    },
    publish_contract: async (artifact) => {
      const receipt = await sdk.execute(create_package_publish_transaction({ artifact, recipient: account.address }), {
        include: { objectTypes: true },
      })
      return Object.freeze({ receipt })
    },
    upgrade_contract: async ({ artifact, upgrade_cap }) => {
      await sdk.hydrate([upgrade_cap])
      const { package: package_id, policy } = await read_package_upgrade(upgrade_cap)
      const receipt = await sdk.execute(
        create_package_upgrade_transaction({ sdk, artifact, package: package_id, upgrade_cap, policy }),
        { include: { objectTypes: true } }
      )
      return Object.freeze({ receipt })
    },
    read_package_upgrade,
    bootstrap_deployment: async (deployment) => {
      await sdk.hydrate([deployment.publisher, DISPLAY_REGISTRY_ID])
      return sdk.execute(
        await create_deployment_bootstrap_transaction({
          sdk,
          package_id: deployment.package,
          kiosk_package: deployment.kiosk_package,
          publisher: deployment.publisher,
          recipient: account.address,
        }),
        { include: { objectTypes: true } }
      )
    },
    read_game_version,
    read_game_paused: async (version) => (await read_game_version(version)) === 0,
    set_game_paused: async ({ package_id, version, admin_cap, paused }) => {
      await sdk.hydrate([version, admin_cap])
      const { create_version_admin_transaction } = await import('./deployment_admin.ts')
      const receipt = await sdk.execute(
        create_version_admin_transaction({
          sdk,
          package_id,
          version,
          admin_cap,
          action: paused ? 'pause' : 'resume',
        })
      )
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
    read_marketplace_royalties: async () => {
      const { read_marketplace_royalties } = await import('./marketplace_admin.ts')
      return read_marketplace_royalties(sdk, account.address)
    },
    claim_marketplace_royalties: async () => {
      const { claim_marketplace_royalties } = await import('./marketplace_admin.ts')
      return claim_marketplace_royalties(sdk, account.address)
    },
    on_invalidated: (listener) => {
      invalidated_listener = listener
      return () => {
        if (invalidated_listener === listener) invalidated_listener = null
      }
    },
    disconnect: async () => {
      stop_events()
      invalidated_listener = null
      await disconnect?.disconnect?.()
    },
  })
}

const connect_wallet = async (
  wallet: Wallet,
  network: BrowserAuthOptions['network'],
  client: SuiGraphQLClient,
  resolution_client: SuiGrpcClient,
  silent = false
): Promise<AuthSession> => {
  const [account] = await request_wallet_accounts(wallet, silent)
  if (!account) throw new Error(`${wallet.name} returned no account`)
  return create_wallet_session(wallet, account, network, client, resolution_client)
}

export const create_browser_auth = (options: BrowserAuthOptions) => {
  const client = new SuiGraphQLClient({ network: options.network, url: options.graphql_url })
  const resolution_client = new SuiGrpcClient({
    network: options.network,
    baseUrl: options.rpc_url ?? `https://fullnode.${options.network}.sui.io:443`,
  })
  const registration = registerEnokiWallets({
    apiKey: options.enoki_api_key,
    providers: { google: { clientId: options.google_client_id, redirectUrl: options.redirect_url } },
    clients: [client],
    getCurrentNetwork: () => options.network,
  })
  const { google } = registration.wallets
  const wrap = (wallet: Wallet): AuthWallet =>
    Object.freeze({
      name: wallet.name,
      connect: () => connect_wallet(wallet, options.network, client, resolution_client),
    })

  return Object.freeze({
    connect_google: () => {
      if (!google) throw new Error('Google login is unavailable')
      return connect_wallet(google, options.network, client, resolution_client)
    },
    wallets: (): readonly AuthWallet[] => installed_wallets().map(wrap),
    restore: async (wallet_name: string): Promise<AuthSession | null> => {
      const wallet = [google, ...getWallets().get()].find((candidate) => candidate?.name === wallet_name)
      return wallet ? connect_wallet(wallet, options.network, client, resolution_client, true) : null
    },
    dispose: () => registration.unregister(),
  })
}

export const create_wallet_auth = (options: WalletAuthOptions) => {
  const client = new SuiGraphQLClient({ network: options.network, url: options.graphql_url })
  const resolution_client = new SuiGrpcClient({
    network: options.network,
    baseUrl: options.rpc_url ?? `https://fullnode.${options.network}.sui.io:443`,
  })
  const wrap = (wallet: Wallet): SelectableAuthWallet => {
    let accounts: readonly WalletAccount[] | null = null
    const disconnect = wallet.features['standard:disconnect'] as { disconnect?: () => Promise<void> } | undefined
    return Object.freeze({
      name: wallet.name,
      authorize: async () => {
        accounts = await request_wallet_accounts(wallet)
        return Object.freeze(accounts.map(({ address }) => address))
      },
      connect: async (address: string) => {
        const account = accounts?.find((candidate) => candidate.address === address)
        if (!account) throw new Error(`${address} is not authorized in ${wallet.name}`)
        return create_wallet_session(wallet, account, options.network, client, resolution_client)
      },
      disconnect: async () => {
        accounts = null
        await disconnect?.disconnect?.()
      },
    })
  }
  return Object.freeze({
    wallets: (): readonly SelectableAuthWallet[] => installed_wallets().map(wrap),
  })
}

export type BrowserAuth = ReturnType<typeof create_browser_auth>

export const canonical_suins_name = (value: string): string => {
  const name = value.trim().toLowerCase()
  if (name.startsWith('@')) return `${name.slice(1)}.sui`
  const subname = /^([^@\s]+)@([^@\s]+)$/.exec(name)
  return subname ? `${subname[1]}.${subname[2]}.sui` : name
}
