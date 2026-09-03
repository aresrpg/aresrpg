// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fixed-budget, epoch-bound admin delegation. The connected super capability chooses only the recipient.

import type { Receipt } from './cache.ts'
import type { Sdk } from './client.ts'
import { create_seed_session_authorization_transaction } from './seed_admin.ts'

export const delegate = async (sdk: Sdk, recipient: string, funding_mist: bigint): Promise<Receipt> => {
  const { admin_cap } = sdk.pins
  if (typeof admin_cap !== 'string' || !admin_cap) throw new Error('pins.json has no super AdminCap')
  await sdk.hydrate([admin_cap])
  return sdk.execute(create_seed_session_authorization_transaction({ sdk, admin_cap, recipient, funding_mist }), {
    budget: 'estimate',
    include: { objectTypes: true },
  })
}
