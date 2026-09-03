// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { archimob_rows } from '../src/archimob.ts'

test('archimob rows derive only placed normal members of a family with one archi', () => {
  const mobs = [
    { mob_type: 'fuwa', family: 'fuwa', role: 'normal' },
    { mob_type: 'nifuwa', family: 'fuwa', role: 'normal' },
    { mob_type: 'fukuo', family: 'fuwa', role: 'archi' },
    { mob_type: 'boss', family: 'fuwa', role: 'boss' },
  ]
  expect(archimob_rows(mobs, ['fuwa', 'nifuwa', 'boss', 'fuwa'])).toEqual([
    { ordinary_type: 'fuwa', archi_type: 'fukuo' },
    { ordinary_type: 'nifuwa', archi_type: 'fukuo' },
  ])
})
