// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1368 — Character's fully-qualified type string belongs to the SDK deployment home. The frontend may
// normalize that value for kiosk comparison, but must never reconstruct the SDK-owned type spelling.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const source = readFileSync(new URL('../../src/chain/character_lineage.ts', import.meta.url), 'utf8')

describe('Character type string has one deployment home', () => {
  test('the frontend imports the SDK derivation and carries no local type-string template', () => {
    expect(source).toMatch(/import\s*\{[^}]*character_type[^}]*\}\s*from '@aresrpg\/sdk\/deployment\/aresrpg'/s)
    expect(source).not.toContain('`${pkg}::character::Character`')
  })
})
