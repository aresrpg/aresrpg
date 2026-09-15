// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { error_text, localized_error } from '../../src/i18n/error_text.ts'
import { player_error_text } from '../../src/i18n/player_error.ts'

test('raw failures use localized categories while uncertain receipts keep their explicit warning', async () => {
  const copy = await load_app_copy('fr')
  expect(error_text(copy.kares_page, new Error('User rejected the request'))).toBe(copy.kares_page.error_rejected)
  expect(error_text(copy.kares_page, new Error('Insufficient balance'))).toBe(copy.kares_page.error_funds)
  expect(player_error_text(copy, new Error('MoveAbort private diagnostic'))).toBe(copy.kares_page.error_generic)
  expect(player_error_text(copy, '[sdk] transaction outcome unknown: digest')).toBe(copy.transaction_unknown_toast)
  expect(localized_error('Une action précise').message).toBe('Une action précise')
})

test('raw string failures are translated while tagged gameplay refusals keep their precise message', async () => {
  const { on_error_translate, toast } = await import('../../src/toast.ts')
  const copy = await load_app_copy('fr')
  const shown: string[] = []
  const unsubscribe = toast.subscribe((event) => {
    if (event.type === 'show') shown.push(event.toast.message)
  })
  on_error_translate((message, raw) => (raw ? error_text(copy.kares_page, message) : null))
  try {
    toast.add('provider internals are not player copy')
    toast.add(localized_error('Une action précise'))
    expect(shown).toEqual([copy.kares_page.error_generic, 'Une action précise'])
  } finally {
    unsubscribe()
    on_error_translate(null)
  }
})
