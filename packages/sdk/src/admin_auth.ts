// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Explicit wallet administration operations. Gameplay sessions never
// receive these methods.

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress, normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'
import { ZkSendClient } from '@mysten/zksend'

import { admin_wallet_context, type AuthSession } from './auth.ts'
import { receipt_digest, type Receipt } from './cache.ts'
import { SDK, sui_transport } from './client.ts'
import { delegate } from './delegated_admin.ts'
import {
  create_kares_setup_transaction,
  create_kares_settlement_transaction,
  create_kares_start_transaction,
  create_kares_community_claim_transaction,
  create_kares_combat_seed_transaction,
  create_kares_combat_authorization_transaction,
  kares_pins,
  type OfferingSetup,
} from './kares_ptb.ts'
import { read_kares_metadata, update_kares_metadata_into, type KaresMetadataUpdate } from './kares_metadata.ts'
import {
  create_deployment_bootstrap_transaction,
  create_package_publish_transaction,
  create_package_upgrade_transaction,
  DISPLAY_REGISTRY_ID,
  type ContractArtifact,
  type GameDeployment,
} from './deployment_admin.ts'

export type AdminAuthSession = AuthSession &
  Readonly<{
    authorize_temp_admin: (to: string, mist: bigint) => Promise<Receipt>
    publish_contract: (artifact: ContractArtifact) => Promise<Readonly<{ receipt: Receipt }>>
    upgrade_contract: (
      deployment: Readonly<{ artifact: ContractArtifact; upgrade_cap: string }>
    ) => Promise<Readonly<{ receipt: Receipt }>>
    read_package_upgrade: (
      upgrade_cap: string
    ) => Promise<Readonly<{ package: string; version: number; policy: number }>>
    bootstrap_deployment: (deployment: GameDeployment) => Promise<Receipt>
    setup_kares: (terms: OfferingSetup) => Promise<Receipt>
    start_kares: () => Promise<Receipt>
    settle_kares: () => Promise<Receipt>
    seed_combat_kares: () => Promise<Receipt>
    authorize_combat_kares: () => Promise<Receipt>
    claim_community_kares: () => Promise<Receipt>
    update_kares_metadata: (update: KaresMetadataUpdate) => Promise<Receipt>
    create_giftcard_links: (
      cards: readonly Readonly<{ id: string; key: string }>[]
    ) => Promise<Readonly<{ digest: string; urls: readonly string[] }>>
  }>

const giftcard_keypair = (key: string): Ed25519Keypair => {
  const decoded = decodeSuiPrivateKey(key)
  if (decoded.scheme !== 'ED25519') throw new Error('A zkSend giftcard link requires an Ed25519 key')
  return Ed25519Keypair.fromSecretKey(decoded.secretKey)
}

const address_owner = (owner: unknown): string | null => {
  if (!owner || typeof owner !== 'object') return null
  const row = owner as Readonly<{ $kind?: string; AddressOwner?: string }>
  return row.$kind === 'AddressOwner' && typeof row.AddressOwner === 'string'
    ? normalizeSuiObjectId(row.AddressOwner)
    : null
}

type GiftcardLinkContext = Readonly<{
  address: string
  client: SuiGrpcClient
  game_type_package: string
  execute: (transaction: Awaited<ReturnType<ZkSendClient['createLinks']>>) => Promise<Receipt>
}>

const assert_giftcard_custody = async (
  context: GiftcardLinkContext,
  cards: readonly Readonly<{ id: string; key: string }>[]
): Promise<readonly Readonly<{ id: string; keypair: Ed25519Keypair }>[]> => {
  if (cards.length < 1 || cards.length > 100) throw new Error('A giftcard export must contain 1..100 cards')
  const normalized = cards.map(({ id, key }) =>
    Object.freeze({ id: normalizeSuiObjectId(id), keypair: giftcard_keypair(key) })
  )
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length)
    throw new Error('A giftcard export cannot reuse an object')
  if (new Set(normalized.map(({ keypair }) => keypair.toSuiAddress())).size !== normalized.length)
    throw new Error('A giftcard export cannot reuse a bearer key')
  const ids = normalized.map(({ id }) => id)
  const pages = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, index * 50 + 50))
  const objects = (
    await Promise.all(
      pages.map((object_ids) => context.client.core.getObjects({ objectIds: object_ids, include: { json: true } }))
    )
  ).flatMap((page) => page.objects)
  const expected_type = normalizeStructTag(`${context.game_type_package}::distribution::Giftcard`)
  if (
    objects.length !== normalized.length ||
    objects.some(
      (object, index) =>
        object instanceof Error ||
        typeof object.objectId !== 'string' ||
        normalizeSuiObjectId(object.objectId) !== normalized[index]?.id ||
        !object.type ||
        normalizeStructTag(object.type) !== expected_type ||
        address_owner(object.owner) !== normalizeSuiObjectId(context.address)
    )
  )
    throw new Error('Every exported Giftcard must be canonical and owned by the connected signer')
  return Object.freeze(normalized)
}

export const create_admin_giftcard_links = async (
  context: GiftcardLinkContext,
  cards: readonly Readonly<{ id: string; key: string }>[]
): Promise<Readonly<{ digest: string; urls: readonly string[] }>> => {
  const checked = await assert_giftcard_custody(context, cards)
  const client = new ZkSendClient(context.client)
  const links = checked.map(({ id, keypair }) => {
    const link = client.linkBuilder({ sender: context.address, keypair })
    link.addClaimableObject(id)
    return link
  })
  const receipt = await context.execute(await client.createLinks({ links }))
  return Object.freeze({ digest: receipt_digest(receipt), urls: Object.freeze(links.map((link) => link.getLink())) })
}

const upgrade_package_id = (value: unknown): string => {
  if (typeof value !== 'string' || !isValidSuiAddress(value))
    throw new Error('The package UpgradeCap has an invalid package ID')
  return value
}

const upgrade_version = (value: unknown): number => {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('The package UpgradeCap has an invalid version')
  return version
}

const upgrade_policy = (value: unknown): number => {
  const policy = Number(value)
  if (!Number.isInteger(policy) || policy < 0 || policy > 255)
    throw new Error('The package UpgradeCap has an invalid policy')
  return policy
}

const package_upgrade = (
  capability: Error | Readonly<{ objectId?: string; json?: Readonly<Record<string, unknown>> | null }> | undefined,
  upgrade_cap: string
): Readonly<{ package: string; version: number; policy: number }> => {
  if (!capability || capability instanceof Error || capability.objectId !== upgrade_cap)
    throw new Error('The package UpgradeCap is unavailable')
  return Object.freeze({
    package: upgrade_package_id(capability.json?.package),
    version: upgrade_version(capability.json?.version),
    policy: upgrade_policy(capability.json?.policy),
  })
}

export const as_admin_session = (session: AuthSession): AdminAuthSession => {
  const context = admin_wallet_context(session)
  const read_package_upgrade = async (
    upgrade_cap: string
  ): Promise<Readonly<{ package: string; version: number; policy: number }>> => {
    const { objects } = await context.read_client.core.getObjects({ objectIds: [upgrade_cap], include: { json: true } })
    const capability = objects.find((candidate) => !(candidate instanceof Error) && candidate.objectId === upgrade_cap)
    return package_upgrade(capability, upgrade_cap)
  }

  return Object.freeze({
    ...session,
    authorize_temp_admin: (to, mist) => delegate(context.sdk, to, mist),
    publish_contract: async (artifact) => {
      const receipt = await context.sdk.execute(
        create_package_publish_transaction({ artifact, recipient: context.account.address }),
        { budget: 'estimate', include: { objectTypes: true } }
      )
      return Object.freeze({ receipt })
    },
    upgrade_contract: async ({ artifact, upgrade_cap }) => {
      await context.sdk.hydrate([upgrade_cap])
      const { package: package_id, policy } = await read_package_upgrade(upgrade_cap)
      const receipt = await context.sdk.execute(
        create_package_upgrade_transaction({ sdk: context.sdk, artifact, package: package_id, upgrade_cap, policy }),
        { budget: 'estimate', include: { objectTypes: true } }
      )
      return Object.freeze({ receipt })
    },
    read_package_upgrade,
    setup_kares: async (terms) => {
      const upgrade = await read_package_upgrade(terms.upgrade_cap)
      if (normalizeSuiObjectId(upgrade.package) !== normalizeSuiObjectId(terms.package) || upgrade.version !== 1)
        throw new Error('KARES setup requires its original, never-upgraded publication capability')
      await context.sdk.hydrate([terms.genesis, terms.upgrade_cap, terms.currency, normalizeSuiObjectId('0xc')])
      return context.sdk.execute(create_kares_setup_transaction(context.sdk, terms), {
        budget: 'estimate',
        include: { objectTypes: true },
      })
    },
    start_kares: () =>
      context.sdk.execute(create_kares_start_transaction(kares_pins(context.sdk.pins)), {
        budget: 'estimate',
        include: { objectTypes: true },
      }),
    settle_kares: () =>
      context.sdk.execute(create_kares_settlement_transaction(kares_pins(context.sdk.pins)), {
        budget: 'estimate',
        include: { objectTypes: true },
      }),
    claim_community_kares: () =>
      context.sdk.execute(
        create_kares_community_claim_transaction(kares_pins(context.sdk.pins), context.account.address),
        { budget: 'estimate', include: { objectTypes: true } }
      ),
    seed_combat_kares: () =>
      context.sdk.execute(create_kares_combat_seed_transaction(kares_pins(context.sdk.pins)), {
        budget: 'estimate',
        include: { objectTypes: true },
      }),
    authorize_combat_kares: () =>
      context.sdk.execute(
        create_kares_combat_authorization_transaction(kares_pins(context.sdk.pins), context.sdk.game_type_package),
        { budget: 'estimate', include: { objectTypes: true } }
      ),
    update_kares_metadata: async (update) => {
      const pins = kares_pins(context.sdk.pins)
      const metadata = await read_kares_metadata(context.resolution_client, pins.currency, pins.original)
      if (!metadata.metadata_cap || metadata.owner !== normalizeSuiObjectId(context.account.address))
        throw new Error('Connect the cold wallet that owns the KARES metadata capability')
      await context.sdk.hydrate([metadata.metadata_cap])
      const transaction = new Transaction()
      update_kares_metadata_into(transaction, context.sdk, pins, metadata.metadata_cap, update)
      return context.sdk.execute(transaction, { budget: 'estimate', include: { objectTypes: true } })
    },
    bootstrap_deployment: async (deployment) => {
      const sdk = SDK({
        client: sui_transport(context.resolution_client),
        address: context.account.address,
        network: context.network,
        sign_transaction: context.sign_transaction,
        pins: {
          ...context.sdk.pins,
          package: deployment.package,
          package_original: deployment.package,
          kiosk_package: deployment.kiosk_package,
          version: deployment.version,
          loot_registry: deployment.loot_registry,
          name_registry: deployment.name_registry,
          friend_registry: deployment.friend_registry,
        },
      })
      await sdk.hydrate([deployment.publisher, DISPLAY_REGISTRY_ID])
      const receipt = await sdk.execute(
        await create_deployment_bootstrap_transaction({
          sdk,
          package_id: deployment.package,
          kiosk_package: deployment.kiosk_package,
          publisher: deployment.publisher,
          recipient: context.account.address,
        }),
        { budget: 'estimate', include: { objectTypes: true } }
      )
      receipt_digest(receipt)
      return receipt
    },
    create_giftcard_links: (cards) => {
      const { game_type_package } = context.sdk
      if (!game_type_package) throw new Error('Giftcard export requires a published game package')
      return create_admin_giftcard_links(
        Object.freeze({
          address: context.account.address,
          client: context.resolution_client,
          game_type_package,
          execute: (transaction) => context.sdk.execute(transaction, { budget: 'estimate' }),
        }),
        cards
      )
    },
  })
}
