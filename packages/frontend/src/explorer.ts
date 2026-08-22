// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Network } from './env.ts'

const explorer_origin = (network: Network): string =>
  `https://${network === 'mainnet' ? 'suivision.xyz' : `${network}.suivision.xyz`}`

export const explorer_object_url = (network: Network, object_id: string): string =>
  `${explorer_origin(network)}/object/${object_id}`

export const explorer_transaction_url = (network: Network, digest: string): string =>
  `${explorer_origin(network)}/txblock/${digest}`
