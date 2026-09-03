// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Trusted wallet operations used by the standalone operator signer. Gameplay sessions never
// receive these methods.

import { isValidSuiAddress } from '@mysten/sui/utils'

import { operator_wallet_context, type AuthSession } from './auth.ts'
import { receipt_digest, type Receipt } from './cache.ts'
import { SDK, sui_transport } from './client.ts'
import { delegate } from './delegated_admin.ts'
import {
  create_deployment_bootstrap_transaction,
  create_package_publish_transaction,
  create_package_upgrade_transaction,
  DISPLAY_REGISTRY_ID,
  type ContractArtifact,
  type GameDeployment,
} from './deployment_admin.ts'

export type OperatorAuthSession = AuthSession &
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
  }>

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

export const as_operator_session = (session: AuthSession): OperatorAuthSession => {
  const context = operator_wallet_context(session)
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
  })
}
