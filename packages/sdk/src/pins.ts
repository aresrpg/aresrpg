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

/** The living-content derivation pair: the registry ROOT object id + the seed package's
 * ORIGINAL id — every content address (mob/spell templates, world content, the board
 * catalog) derives from these two. The ORIGINAL, never `pins.seed_package`: a derived object
 * id is computed from a type tag, and on Sui a type is named by its FIRST-publish address
 * forever, while the latest id is a move-call target only (2026-08-22: deriving with the
 * upgraded address produced ids that never existed — every mob engage died unresolved). */
export const living_content = (
  sdk: Readonly<{ pins: Pins }>,
  what: string
): Readonly<{ content_root: string; seed_package_original: string }> => {
  const root = sdk.pins.content_root
  const root_id = typeof root === 'object' && root !== null ? Reflect.get(root, 'id') : null
  const original = sdk.pins.seed_package_original
  if (typeof root_id !== 'string' || typeof original !== 'string')
    throw new Error(`${what} unavailable: pins.json has no living-content ids for this network.`)
  return Object.freeze({ content_root: root_id, seed_package_original: original })
}
