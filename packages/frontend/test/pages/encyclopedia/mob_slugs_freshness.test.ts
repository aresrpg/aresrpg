// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import mob_slugs from '../../../src/pages/encyclopedia/mob_slugs.json'

import served_mob_names from './mob_slugs.fixture'

test('every mob name served by /v1 has a mob_slugs portrait key', () => {
  const missing = served_mob_names.filter((name) => !Object.hasOwn(mob_slugs, name))

  expect(missing).toEqual([])
})
