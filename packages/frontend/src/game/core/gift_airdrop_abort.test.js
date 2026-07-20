// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// gift + airdrop lane — proves (1) the abort decoder maps every gift/airdrop Move code to real player copy (never
// the generic "failed" line, never "[object Object]"), and (2) the i18n law: all SIX locales carry an IDENTICAL
// set of the new gift.* / airdrop.* / nav.airdrop keys (no key added to one locale and forgotten in another).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import i18n from '../../i18n'

import { parse_move_abort, humanize_tx_error } from './abort_copy.js'

// The gRPC Core structured MoveAbort shape run_tx hands the decoder (mirrors abort_copy.test.js).
const grpc_abort = (module, code) => ({
  $kind: 'MoveAbort',
  MoveAbort: { abortCode: String(code), location: { package: '0x0abc', module, function: 1, instruction: 1 } },
})

describe('gift + airdrop aborts → honest player copy (never generic, never raw)', () => {
  const cases = [
    ['gift', 101, 'errors.gift_not_recipient'],
    ['gift', 102, 'errors.gift_not_sender'],
    ['gift', 103, 'errors.gift_empty'],
    ['airdrop', 101, 'errors.airdrop_not_eligible'],
    ['airdrop', 102, 'errors.airdrop_wrong_template'],
  ]
  for (const [module, code, key] of cases) {
    test(`${module} ${code} → ${key}`, () => {
      expect(parse_move_abort(grpc_abort(module, code))).toEqual({ module, code, package: '0x0abc' })
      const out = humanize_tx_error(grpc_abort(module, code))
      expect(out).toBe(i18n.t(key))
      expect(out).not.toBe('[object Object]')
      expect(out).not.toBe(i18n.t('errors.tx_failed'))
    })
  }

  test('an unmapped gift code degrades to the generic line (never raw)', () => {
    expect(humanize_tx_error(grpc_abort('gift', 999))).toBe(i18n.t('errors.tx_failed'))
  })
})

describe('i18n law — the new gift/airdrop keys exist in ALL 6 locales, identically', () => {
  const LANGS = ['en', 'fr', 'de', 'es', 'ja', 'uk']
  const LOC = join(import.meta.dir, '../../i18n/locales')

  const leaves = (obj, prefix = '') => {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      const kp = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, leaves(v, kp))
      else out[kp] = v
    }
    return out
  }
  const is_new = (k) => k.startsWith('gift.') || k.startsWith('airdrop.') || k === 'nav.airdrop'

  const key_sets = Object.fromEntries(
    LANGS.map((l) => {
      const data = JSON.parse(readFileSync(join(LOC, `${l}.json`), 'utf8'))
      return [l, new Set(Object.keys(leaves(data)).filter(is_new))]
    })
  )

  test('English carries the new keys (sanity floor)', () => {
    expect(key_sets.en.size).toBeGreaterThanOrEqual(60)
  })

  for (const l of LANGS.filter((x) => x !== 'en')) {
    test(`${l} has the exact same new-key set as en (no missing, no extra)`, () => {
      const missing = [...key_sets.en].filter((k) => !key_sets[l].has(k))
      const extra = [...key_sets[l]].filter((k) => !key_sets.en.has(k))
      expect({ lang: l, missing, extra }).toEqual({ lang: l, missing: [], extra: [] })
    })
  }
})
