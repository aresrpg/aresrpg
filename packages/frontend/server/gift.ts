// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_gift_gateway, type GiftGatewayOptions } from '../../sdk/src/gift_gateway.ts'
import type { Pins } from '../../sdk/src/pins.ts'

import { gift_policy } from './gift_policy.ts'

export const serve_gift = (
  request: Request,
  options: Readonly<{ pins: Pins; private_key?: string } & Pick<GiftGatewayOptions, 'rpc_url' | 'graphql_url'>>
): Promise<Response> => create_gift_gateway({ ...options, policy: gift_policy(options.pins) })(request)
