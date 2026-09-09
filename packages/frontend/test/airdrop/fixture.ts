// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, beforeEach, spyOn } from 'bun:test'

import * as claims from '../../src/modules/claims.ts'

export const TEMPLATE_ID = `0x${'ab'.repeat(32)}`
export const use_template_fixture = (): void => {
  let lookup: ReturnType<typeof spyOn<typeof claims, 'rolled_item_types'>>
  beforeEach(() => {
    lookup = spyOn(claims, 'rolled_item_types').mockReturnValue(new Map([[TEMPLATE_ID, 'sui_crate']]))
  })
  afterEach(() => lookup.mockRestore())
}
