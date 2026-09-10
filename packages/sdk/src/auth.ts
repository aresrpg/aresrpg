// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export { MAX_GIFTCARDS_PER_TRANSACTION } from './giftcard_batch.ts'
import { registerEnokiWallets } from '@mysten/enoki'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { isValidSuiAddress } from '@mysten/sui/utils'
import type { GiftcardRow, TradeRow } from '@aresrpg/protocol'
import { getWallets, type Wallet, type WalletAccount } from '@mysten/wallet-standard'

import { canonical_suins_name } from './suins.ts'
import { character_claim_id, character_create, character_id, type CharacterCreateInput } from './character.ts'
import { read_character_checkpoint as read_checkpoint, type CharacterCheckpoint } from './character_checkpoint.ts'
import { create_item_snapshot_reader, type ItemSnapshot } from './item_snapshot.ts'
import { gas_mist_from_receipt } from './gas.ts'
import { SDK, sui_transport, type TransactionSigner, type Pins } from './client.ts'
import { sui_transfer_ptb } from './sui_transfer.ts'
import type { MarketplaceRoyalty, claim_marketplace_royalties as claim_royalties } from './marketplace_admin.ts'
import { marketplace_actions, type MarketplaceActions } from './marketplace.ts'
import { stack_actions, type StackActions } from './stacks.ts'
import { trade_actions, trade_create, type TradeActions } from './trade.ts'
import type { GiftcardTransfer } from './distribution.ts'
import { character_actions, type CharacterActions } from './character_actions.ts'
import { fight_actions, type FightActions } from './fight.ts'
import { dungeon_actions, type DungeonActions } from './dungeon.ts'
import { kolizeum_actions, type KolizeumActions } from './kolizeum.ts'
import { friends_actions, type FriendsActions } from './friends.ts'
import { party_actions, type PartyActions } from './party.ts'
import { mastery_actions, type MasteryActions } from './mastery.ts'
import { kares_actions, type KaresActions } from './kares_actions.ts'
import {
  create_wallet_binding,
  installed_wallets,
  on_wallets_changed,
  request_wallet_accounts,
  selectable_wallet,
} from './wallet_standard.ts'
import { receipt_digest } from './cache.ts'
import { create_personal_kiosk_runner } from './kiosk_runner.ts'

export type { CharacterActions, ScribeOutcome } from './character_actions.ts'
export type { FightActions } from './fight.ts'
export type { DungeonActions } from './dungeon.ts'
export type { KolizeumActions } from './kolizeum.ts'
export type { FriendsActions } from './friends.ts'
export type { PartyActions } from './party.ts'
export type { MasteryActions } from './mastery.ts'
export type { ItemSnapshot } from './item_snapshot.ts'

const select_personal_kiosk = (caps: readonly KioskOwnerCap[], kiosk_id?: string): KioskOwnerCap | null =>
  (kiosk_id ? caps.find(({ kioskId }) => kioskId === kiosk_id) : caps[0]) ?? null

const receipt_fresh_kiosk_cap = (sdk: ReturnType<typeof SDK>, cap: KioskOwnerCap, fresh: boolean): KioskOwnerCap => {
  if (fresh) return cap
  const current = sdk.ref(cap.objectId)
  return current ? Object.freeze({ ...cap, ...current }) : cap
}

export type AuthSession = Readonly<{
  address: string
  wallet_name: string
  identity: 'zklogin' | 'wallet'
  sign_personal_message: (message: Uint8Array) => Promise<{ bytes: string; signature: string }>
  read_sui_balance: () => Promise<bigint>
  read_kares_balance: () => Promise<bigint | null>
  gas_spent_24h: () => bigint
  derive_character_id: (name: string) => string
  is_character_name_claimed: (name: string) => Promise<boolean>
  create_character: (
    character: CharacterCreateInput,
    first_world: string
  ) => Promise<Readonly<{ digest: string; character_id: string }>>
  /** the remote-fight chain hand — duels and PvM share it (local vs remote is the ONLY split) */
  fight: FightActions
  dungeon: DungeonActions
  kolizeum: KolizeumActions
  friends: FriendsActions
  party: PartyActions
  mastery: MasteryActions
  kares: KaresActions
  /** the character-upkeep chain hand — equipment, stats, spells, consumables, runes */
  character: CharacterActions
  read_character_checkpoint: (character_id: string, expected_world: string) => Promise<CharacterCheckpoint | null>
  read_item: (item_id: string) => Promise<ItemSnapshot>
  marketplace: MarketplaceActions
  stacks: StackActions
  create_trade: (
    counterparty: string,
    cleanup?: readonly string[]
  ) => Promise<Readonly<{ digest: string; trade: TradeRow }>>
  trade: (trade: TradeRow) => TradeActions
  resolve_suins_address: (name: string) => Promise<string | null>
  estimate_sui_transfer: (recipient: string, amount_mist: bigint, drain: boolean) => Promise<bigint>
  send_sui: (recipient: string, amount_mist: bigint, drain: boolean) => Promise<Readonly<{ digest: string }>>
  read_giftcards: () => Promise<readonly GiftcardRow[]>
  transfer_giftcards: (
    transfers: readonly GiftcardTransfer[]
  ) => Promise<Readonly<{ digest: string; giftcards: readonly GiftcardRow[] }>>
  claim_giftcard_link: (url: string) => Promise<Readonly<{ digest: string; giftcard: GiftcardRow }>>
  redeem_giftcards: (
    cards: readonly GiftcardRow[],
    received_transaction?: string
  ) => Promise<Readonly<{ digest: string }>>
  read_marketplace_royalties: () => Promise<readonly MarketplaceRoyalty[]>
  claim_marketplace_royalties: () => ReturnType<typeof claim_royalties>
  dispose?: () => void
  on_invalidated?: (listener: () => void) => () => void
  disconnect: () => Promise<void>
}>

export type AuthWallet = Readonly<{
  name: string
  connect: () => Promise<AuthSession>
}>

export type SelectableAuthWallet = Readonly<{
  name: string
  authorize: (silent?: boolean) => Promise<readonly string[]>
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
  pins?: Pins
}>
export type WalletAuthOptions = Pick<BrowserAuthOptions, 'graphql_url' | 'network' | 'rpc_url' | 'pins'>

export type AdminWalletContext = Readonly<{
  account: WalletAccount
  network: BrowserAuthOptions['network']
  read_client: SuiGraphQLClient
  resolution_client: SuiGrpcClient
  sdk: ReturnType<typeof SDK>
  sign_transaction: TransactionSigner
}>

const admin_wallet_contexts = new WeakMap<AuthSession, AdminWalletContext>()

export const admin_wallet_context = (session: AuthSession): AdminWalletContext => {
  const context = admin_wallet_contexts.get(session)
  if (!context) throw new Error('The wallet session has no administration context')
  return context
}

const create_wallet_session = (
  wallet: Wallet,
  account: WalletAccount,
  network: BrowserAuthOptions['network'],
  client: SuiGraphQLClient,
  resolution_client: SuiGrpcClient,
  pins?: Pins
): AuthSession => {
  const binding = create_wallet_binding(wallet, account, network)
  const { sign_transaction } = binding
  const sdk = SDK({
    client: sui_transport(resolution_client),
    address: account.address,
    network,
    sign_transaction,
    pins,
  })
  const read_item = create_item_snapshot_reader(client, sdk.game_type_package)
  const registry_pin = (sdk.pins.name_registry as { id?: string | null } | undefined)?.id
  let kiosk_caps: ReturnType<typeof sdk.get_owned_kiosks> | null = null
  const kiosk_cap = async (kiosk_id?: string, fresh = false) => {
    const request = fresh || !kiosk_caps ? sdk.get_owned_kiosks(account.address) : kiosk_caps
    kiosk_caps = request
    try {
      const { kioskOwnerCaps } = await request
      const cap = select_personal_kiosk(
        kioskOwnerCaps.filter(({ isPersonal }) => isPersonal),
        kiosk_id
      )
      if (!cap) {
        kiosk_caps = null
        return null
      }
      return receipt_fresh_kiosk_cap(sdk, cap, fresh)
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
  const session: AuthSession = Object.freeze({
    address: account.address,
    wallet_name: wallet.name,
    identity: 'enoki:getSession' in wallet.features ? 'zklogin' : 'wallet',
    sign_personal_message: binding.sign_personal_message,
    read_sui_balance: sdk.read_sui_balance,
    read_kares_balance: sdk.read_kares_balance,
    gas_spent_24h: sdk.gas_spent_24h,
    derive_character_id: (name: string) => character_id(require_registry(), name),
    is_character_name_claimed: async (name: string) => {
      const claim_id = character_claim_id(require_registry(), name)
      const { objects } = await client.core.getObjects({ objectIds: [claim_id] })
      return objects.some((object) => !(object instanceof Error) && object.objectId === claim_id)
    },
    fight: fight_actions(sdk, { kiosk_cap }),
    dungeon: dungeon_actions(sdk, { kiosk_cap }),
    kolizeum: kolizeum_actions(sdk, { kiosk_cap, address: account.address }),
    friends: friends_actions(sdk, { address: account.address }),
    party: party_actions(sdk, { kiosk_cap }),
    mastery: mastery_actions(sdk, { address: account.address, kiosk_cap }),
    kares: kares_actions({ sdk, client: resolution_client, address: account.address }),
    character: character_actions(sdk, { kiosk_cap }),
    read_character_checkpoint: (id, world) => read_checkpoint(client, sdk.game_type_package, id, world),
    read_item,
    marketplace: marketplace_actions(sdk, { address: account.address, kiosk_cap }),
    stacks: stack_actions(sdk, { kiosk_cap }),
    create_trade: (counterparty, cleanup) => trade_create(sdk, { address: account.address, counterparty, cleanup }),
    trade: (trade) => trade_actions(sdk, { trade, address: account.address, kiosk_cap }),
    create_character: (character, first_world) =>
      personal_kiosk_action(async (kiosk_cap) => {
        const { kiosk_cap: settled_kiosk_cap, ...receipt } = await character_create(
          sdk,
          { ...character, kiosk_cap },
          first_world
        )
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
      return Object.freeze({ digest: receipt_digest(receipt) })
    },
    read_giftcards: async () => {
      const { read_giftcards } = await import('./distribution.ts')
      return read_giftcards(resolution_client, sdk, account.address)
    },
    transfer_giftcards: async (transfers) => {
      const { transfer_giftcards } = await import('./distribution.ts')
      return transfer_giftcards(resolution_client, sdk, account.address, transfers)
    },
    claim_giftcard_link: async (url) => {
      const { claim_giftcard_link } = await import('./distribution.ts')
      return claim_giftcard_link(resolution_client, sdk, url, account.address)
    },
    redeem_giftcards: async (cards, received_transaction) => {
      const { redeem_giftcards } = await import('./distribution.ts')
      return personal_kiosk_action(async (kiosk_cap) => {
        const result = await redeem_giftcards(sdk, kiosk_cap, cards, received_transaction)
        return Object.freeze({
          value: Object.freeze({ digest: result.digest }),
          kiosk_cap: result.kiosk_cap,
        })
      })
    },
    read_marketplace_royalties: async () => {
      const { read_marketplace_royalties } = await import('./marketplace_admin.ts')
      return read_marketplace_royalties(sdk, account.address)
    },
    claim_marketplace_royalties: async () => {
      const { claim_marketplace_royalties } = await import('./marketplace_admin.ts')
      return claim_marketplace_royalties(sdk, account.address)
    },
    dispose: binding.dispose,
    on_invalidated: binding.on_invalidated,
    disconnect: binding.disconnect,
  })
  admin_wallet_contexts.set(
    session,
    Object.freeze({ account, network, read_client: client, resolution_client, sdk, sign_transaction })
  )
  return session
}

const connect_wallet = async (
  wallet: Wallet,
  network: BrowserAuthOptions['network'],
  client: SuiGraphQLClient,
  resolution_client: SuiGrpcClient,
  silent = false,
  pins?: Pins
): Promise<AuthSession> => {
  const [account] = await request_wallet_accounts(wallet, silent)
  if (!account) throw new Error(`${wallet.name} returned no account`)
  return create_wallet_session(wallet, account, network, client, resolution_client, pins)
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
      connect: () => connect_wallet(wallet, options.network, client, resolution_client, false, options.pins),
    })

  return Object.freeze({
    connect_google: () => {
      if (!google) throw new Error('Google login is unavailable')
      return connect_wallet(google, options.network, client, resolution_client, false, options.pins)
    },
    wallets: (): readonly AuthWallet[] => installed_wallets().map(wrap),
    restore: async (wallet_name: string): Promise<AuthSession | null> => {
      const wallet = [google, ...getWallets().get()].find((candidate) => candidate?.name === wallet_name)
      return wallet ? connect_wallet(wallet, options.network, client, resolution_client, true, options.pins) : null
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
  const wrap = (wallet: Wallet): SelectableAuthWallet =>
    selectable_wallet(wallet, (selected_wallet, account) =>
      create_wallet_session(selected_wallet, account, options.network, client, resolution_client, options.pins)
    )
  return Object.freeze({
    wallets: (): readonly SelectableAuthWallet[] => installed_wallets().map(wrap),
    on_wallets_changed,
  })
}

export type BrowserAuth = ReturnType<typeof create_browser_auth>

export { canonical_suins_name } from './suins.ts'
