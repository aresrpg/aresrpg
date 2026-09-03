// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { world_card_rows } from '../../src/content/world_cards.ts'

test('every authored travel world owns a real landscape card', () => {
  expect(world_card_rows().map(({ id }) => id)).toEqual(['nauvis', 'yakutia'])
  expect(world_card_rows().every(({ art, biomes }) => art?.endsWith('.webp') && biomes.length > 0)).toBeTrue()
})
