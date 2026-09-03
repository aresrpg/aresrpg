// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { consumable_effect_text } from '../../src/encyclopedia/ConsumableEffectSection.tsx'
import type { EncyclopediaText } from '../../src/encyclopedia/copy.ts'

const text = ((key: string, values?: Readonly<Record<string, unknown>>) =>
  values ? `${key}:${Object.values(values).join(':')}` : key) as EncyclopediaText

test('consumable effect copy preserves its authored payload', () => {
  expect(consumable_effect_text({ type: 'heal', amount: 10 }, text)).toBe('consumable_heal:10')
  expect(consumable_effect_text({ type: 'city', city: 'the_ruins' }, text)).toBe('consumable_city:The Ruins')
})
