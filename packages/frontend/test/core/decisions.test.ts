// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const decisions = readFileSync(new URL('../../../../DECISIONS.md', import.meta.url), 'utf8')
const rows = decisions.split('\n').filter((line) => line.startsWith('- '))

test('the mental model contains current rulings, not retained superseded decisions', () => {
  expect(rows.filter((line) => /\bsuperseded\b|\boverruled\b|\breverses the\b/i.test(line))).toEqual([])
})

test('each durable ruling has one titled home', () => {
  const titles = rows.map((line) => line.split(' · ')[1]?.split(' (')[0]?.trim()).filter(Boolean)
  const duplicates = titles.filter((title, index) => titles.indexOf(title) !== index)
  expect(duplicates).toEqual([])
})
