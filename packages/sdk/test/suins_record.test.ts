// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { name_record_bytes } from '../src/suins_record.ts'

import capture from './fixtures/suins_name_record.json'

test('name record codec matches captured mainnet dynamic-field bytes', () => {
  expect(Buffer.from(name_record_bytes(capture.record)).toString('base64')).toBe(capture.option_bcs_base64)
  expect([...name_record_bytes(null)]).toEqual([0])
})

test('complete record comparison detects profile, identity, target, expiry and absence changes', () => {
  const { record } = capture
  for (const changed of [
    null,
    { ...record, data: { ...record.data, avatar: 'changed' } },
    { ...record, data: { ...record.data, unknown: 'new' } },
    { ...record, nftId: '0x1' },
    { ...record, targetAddress: '0x2' },
    { ...record, expirationTimestampMs: record.expirationTimestampMs + 1 },
  ]) {
    expect(name_record_bytes(changed)).not.toEqual(name_record_bytes(record))
  }
})
