// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import DEPLOYMENT from '../../../pins.json' with { type: 'json' }

export type DeploymentNetwork = 'mainnet' | 'testnet'
export type Pins = Readonly<Record<string, unknown>> & {
  network?: DeploymentNetwork
  package?: string | null
  math_package?: string | null
  combat_package?: string | null
  seed_package?: string | null
}

const deployment_network = (value: string): DeploymentNetwork => {
  if (value !== 'mainnet' && value !== 'testnet') throw new Error('Deployment pins need one explicit network')
  return value
}

export const DEFAULT_NETWORK = deployment_network(DEPLOYMENT.network)

/** Explicit test transports may inject pins; file-backed deployments always declare their network. */
export const resolve_pins = (network: DeploymentNetwork, override?: Pins): Pins => {
  const pins = override ?? DEPLOYMENT
  if ((!override || pins.network !== undefined) && pins.network !== network)
    throw new Error(`Deployment pins belong to ${String(pins.network)}, not ${network}`)
  return pins as Pins
}
