// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  blast_csv,
  cap_mist,
  normalize_address,
  public_award,
  share_version,
  sui_amount,
} from '@aresrpg/immutable/allocation'

const address = (value: number): string => normalize_address(`0x${value.toString(16)}`)

describe('published allocations', () => {
  test('public awards expose only the public campaign fields', () => {
    const private_row = {
      address: address(1),
      tier: 'veteran' as const,
      source: 'manual' as const,
      evidence: 'private operator note',
      private_email: 'private@example.test',
    }
    expect(public_award(private_row)).toEqual({ address: address(1), tier: 'veteran', source: 'reserved' })
  })
  test('pins the tier caps', () => {
    expect(cap_mist('veteran')).toBe(125000000000n)
    expect(cap_mist('member')).toBe(70000000000n)
    expect(sui_amount(cap_mist('member'))).toBe('70')
  })
  test('CSV contains exact normalized addresses and decimal caps, no spreadsheet formulas', () => {
    expect(blast_csv([{ address: '0x1', tier: 'veteran', source: 'manual', evidence: '=unsafe' }])).toBe(
      `address,cap_sui,cap_mist\n${address(1)},125,125000000000\n`
    )
    expect(() => blast_csv([{ address: '=unsafe', tier: 'member', source: 'social', evidence: '' }])).toThrow(
      'invalid_address'
    )
  })
  test('share links already published keep their cache version', () => {
    expect(share_version({ tier: 'veteran' })).toBe(
      'voxel-bank-v2-2026-10-28T15:00:00Z-final-veteran-125000000000-833333'
    )
    expect(share_version({ tier: 'member' })).toBe('voxel-bank-v2-2026-10-28T15:00:00Z-final-member-70000000000-466667')
    expect(share_version()).toBe('voxel-bank-v2-2026-10-28T15:00:00Z-final-pending-0-0')
  })
})
