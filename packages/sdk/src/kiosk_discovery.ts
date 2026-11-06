// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { KioskOwnerCap } from '@mysten/kiosk'

import type { Sdk } from './client.ts'

export const read_personal_kiosks = async (sdk: Pick<Sdk, 'get_owned_kiosks'>, address: string) => {
  const result: KioskOwnerCap[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await sdk.get_owned_kiosks(address, { cursor })
    result.push(...page.kioskOwnerCaps.filter((cap) => cap.isPersonal))
    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
    if (page.hasNextPage && (!cursor || seen.has(cursor))) throw new Error('Kiosk ownership pagination changed.')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return result
}
