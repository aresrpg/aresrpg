// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { parse_level_limit } from '../../src/tournament/TournamentSettingsForm.tsx'

test('optional registration levels distinguish unrestricted, valid boundaries, and invalid inputs', () => {
  expect(parse_level_limit('')).toBeNull()
  expect(parse_level_limit(' ')).toBeNull()
  expect(parse_level_limit('1')).toBe(1)
  expect(parse_level_limit('200')).toBe(200)
  for (const invalid of ['0', '201', '-1', '1.5', 'NaN', 'Infinity']) expect(parse_level_limit(invalid)).toBeUndefined()
})
