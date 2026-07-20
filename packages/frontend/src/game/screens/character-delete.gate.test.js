// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE UNPUBLISHED-DOOR GATE (ship-breaker fix): the character-delete UI ships a Delete button whose
// on-chain door (`aresrpg::character_extract`, published at a FUTURE Move-wave ceremony) does not exist
// yet on any live network — the SDK builder throws a raw dev error, and before this gate the button was
// ENABLED and led straight into that wall. These pin the pure block-reason fold (the single home both
// drawer + page variants render from): deployment pin ABSENT → blocked with the honest i18n'd reason;
// pin PRESENT → today's guard matrix unchanged (exploring / playing / equipped / null). Pin presence is
// driven through the SDK's localnet injection seam (`globalThis.__ARES_LOCALNET_IDS`) — the baked
// testnet/mainnet maps are DATA that flips at the ceremony, so no test asserts them directly.
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createInstance } from 'i18next'

import app_i18n from '../../i18n'
import en from '../../i18n/locales/en.json'
import fr from '../../i18n/locales/fr.json'
import de from '../../i18n/locales/de.json'
import es from '../../i18n/locales/es.json'
import ja from '../../i18n/locales/ja.json'
import uk from '../../i18n/locales/uk.json'

import { delete_block_reason } from './character-delete.gate.js'

const inst = (lng, translation) => {
  const i = createInstance()
  i.init({ lng, fallbackLng: 'en', resources: { [lng]: { translation } }, interpolation: { escapeValue: false } })
  return i
}
const EN = inst('en', en)

// The SDK resolves localnet ids from this runtime-injected global (the test/injection seam) — stamp or
// unstamp CHARACTER_EXTRACT_POLICY here to drive the door state without touching the baked release maps.
const STAMPED = { CHARACTER_EXTRACT_POLICY: '0x' + 'a5c1'.padStart(64, '0') }
const set_localnet_ids = (ids) => {
  /** @type {any} */ (globalThis).__ARES_LOCALNET_IDS = ids
}
afterEach(() => {
  delete (/** @type {any} */ (globalThis).__ARES_LOCALNET_IDS)
})

const CLEAN = { id: '0xc1', name: 'Testa', exploring: false }

// the fold reads the APP i18n instance — pin its language so assertions are deterministic (route-test idiom)
beforeAll(async () => {
  await app_i18n.changeLanguage('en')
})

describe('delete_block_reason — the unpublished-door gate (pin absent → honest disable)', () => {
  test('pin ABSENT: even a perfectly deletable character is blocked with the new reason', () => {
    set_localnet_ids({})
    expect(delete_block_reason(CLEAN, { network: 'localnet', selected_id: null })).toBe(
      EN.t('characters.delete.block_unpublished')
    )
  })

  test('pin ABSENT: the door reason WINS over every other guard (one honest reason, no leaks)', () => {
    set_localnet_ids({})
    const exploring = { ...CLEAN, exploring: true }
    expect(delete_block_reason(exploring, { network: 'localnet', selected_id: null })).toBe(
      EN.t('characters.delete.block_unpublished')
    )
  })

  test('pin PRESENT: a clean character is NOT blocked (today’s behavior)', () => {
    set_localnet_ids(STAMPED)
    expect(delete_block_reason(CLEAN, { network: 'localnet', selected_id: null })).toBe(null)
  })

  test('pin PRESENT: the existing guard matrix is untouched (exploring / playing / equipped)', () => {
    set_localnet_ids(STAMPED)
    expect(delete_block_reason({ ...CLEAN, exploring: true }, { network: 'localnet', selected_id: null })).toBe(
      EN.t('characters.delete.block_exploring')
    )
    expect(delete_block_reason(CLEAN, { network: 'localnet', selected_id: '0xc1', in_world: true })).toBe(
      EN.t('characters.delete.block_playing')
    )
    // the page variant (in_world false) must stay deletable while selected — the management surface
    expect(delete_block_reason(CLEAN, { network: 'localnet', selected_id: '0xc1', in_world: false })).toBe(null)
    const equipped = { ...CLEAN, hat: { id: '0xitem' } }
    expect(delete_block_reason(equipped, { network: 'localnet', selected_id: null })).toBe(
      EN.t('characters.delete.block_equipped')
    )
  })
})

describe('characters.delete.block_unpublished — landed in ALL 6 locales (i18n law)', () => {
  test.each([
    ['en', en],
    ['fr', fr],
    ['de', de],
    ['es', es],
    ['ja', ja],
    ['uk', uk],
  ])('%s carries a real translation for the new reason', (lng, translation) => {
    const value = inst(lng, translation).t('characters.delete.block_unpublished')
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(10)
    expect(value).not.toBe('characters.delete.block_unpublished')
  })
})
