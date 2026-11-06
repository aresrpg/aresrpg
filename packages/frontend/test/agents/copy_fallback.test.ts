// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'
import { parse } from 'yaml'

import { copy_text, with_english_ui, type AppCopy } from '../../src/i18n/copy.ts'
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

test('every locale copies the frontend guide and private setup link without unresolved placeholders', () => {
  const guide = 'https://game.example/agents/client.txt'
  const url = 'https://api.example/api/agent-setup?id=test#private-token'
  for (const { code } of LOCALES) {
    const text = copy_text(read(code).ui)
    const prompt = text('agent_setup_prompt', { guide, url })
    expect(prompt).toContain(guide)
    expect(prompt).toContain(url)
    expect(prompt).not.toMatch(/\{(?:guide|url)\}/)
    const handoff = text('agent_handoff_request', { provider: 'Nox', url: guide })
    expect(handoff).toContain('Nox')
    expect(handoff).toContain(guide)
    expect(handoff).not.toContain('agent_kit.ts')
  }
})
