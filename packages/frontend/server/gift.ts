// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_gift_gateway, type GiftGatewayOptions } from '@aresrpg/sdk/gift-gateway'
import type { Pins } from '@aresrpg/sdk/pins'

import { gift_policy } from './gift_policy.ts'

export const serve_gift = (
  request: Request,
  options: Readonly<{ pins: Pins; secret?: string } & Pick<GiftGatewayOptions, 'rpc_url' | 'graphql_url'>>
): Promise<Response> => create_gift_gateway({ ...options, policy: gift_policy(options.pins) })(request)
