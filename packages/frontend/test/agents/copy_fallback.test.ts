// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'
import { parse } from 'yaml'

import { with_english_ui, type AppCopy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const read = (code: string) =>
  parse(readFileSync(resolve(import.meta.dir, `../../src/i18n/locales/${code}.yaml`), 'utf8')) as AppCopy
const english = read('en')
test('every supported locale renders all agent custody and recovery labels, preserving translations', () => {
  const keys = Object.keys(english.ui).filter((key) => key.startsWith('agent_'))
  for (const { code } of LOCALES) {
    const localized = read(code)
    const copy = with_english_ui(localized, english)
    for (const key of keys) {
      expect(typeof copy.ui[key]).toBe('string')
      expect(copy.ui[key]!.length).toBeGreaterThan(0)
      expect(copy.ui[key]).toBe(localized.ui[key] ?? english.ui[key])
    }
  }
})

test('every locale provides hosted MCP, consent and independent recovery copy', () => {
  const keys = Object.keys(english.ui).filter((key) => key.startsWith('agent_hosted_'))
  for (const { code } of LOCALES) {
    const localized = read(code)
    for (const key of keys) expect(localized.ui[key]?.length).toBeGreaterThan(0)
  }
})

test('hosted consent discloses independent custody authority without an extra spending allowance', () => {
  expect(english.ui.agent_hosted_intro).toContain('can each move')
  expect(english.ui.agent_hosted_intro).toContain('neither needs the other’s approval')
  expect(english.ui.agent_hosted_recovery).toContain('does not revoke')
  expect(english.ui.agent_signer_persistent).toBe('Persistent transaction signer verified.')
  for (const { code } of LOCALES) {
    const copy = read(code).ui
    expect(copy.agent_hosted_intro).toContain('AresRPG')
    expect(copy.agent_hosted_intro).toContain('Google')
    expect(copy.agent_signer_persistent?.length).toBeGreaterThan(0)
    expect(copy.agent_hosted_recovery?.length).toBeGreaterThan(0)
  }
})
