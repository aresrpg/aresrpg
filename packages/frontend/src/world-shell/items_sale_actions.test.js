// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRE-FLIGHT REFUSAL VISIBILITY — a kiosk RPC read can fail before a buy PTB exists. The shop's real
// toast path must name that phase honestly, while the opaque RPC payload stays in game_log for diagnosis.

import { readFileSync } from 'node:fs'

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import { get_log_buffer, _reset_log_for_test } from '../core/log.js'
import i18n from '../i18n'
import { use_toast } from '../toast'

const HONEST_TOAST = 'Kiosk lookup failed — network hiccup, nothing was signed or spent; retry is safe.'
const RPC_REFUSAL = {
  code: 'UNAVAILABLE',
  detail: { rpc: 'core.getObject', request_id: 'kiosk-lookup-42', transport: 'grpc' },
}

reset_auth_mock({ address: '0xowner', wallet_name: 'zklogin' })

const { context } = await import('../game/core/game.js')
const selected_character = spyOn(context, 'get_state').mockImplementation(() => ({
  selected_character_id: '0xactive-character',
}))
const { buy_items_sale } = await import('./items_sale_actions.js')

const throwing_sdk = {
  grpc_client: {
    core: {
      getObject: async () => {
        throw RPC_REFUSAL
      },
    },
  },
  kiosk_client: {
    getOwnedKiosks: async () => ({ kioskOwnerCaps: [] }),
  },
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  reset_auth_mock({ address: '0xowner', wallet_name: 'zklogin' })
  set_expedition_sdk_mock(async () => throwing_sdk)
  _reset_log_for_test()
  use_toast.setState({ toasts: [] })
})

afterAll(() => {
  selected_character.mockRestore()
  reset_expedition_sdk_mock()
  reset_auth_mock()
  use_toast.setState({ toasts: [] })
})

describe('buy pre-flight kiosk lookup refusal visibility', () => {
  // #123 ROOT CAUSE (found + fixed, was LIVE-CANDIDATE #117): world-shell/world_checkpoint.test.js registered
  // its OWN direct `mock.module('../chain/sdk', () => ({ get_sdk: async () => ({ grpc_client: {} }) }))` —
  // competing with this shared expedition-sdk mock (test_helpers/expedition_sdk_mock.js) for the SAME
  // process-global registration. bun's mock.module has no unmock API, so whichever file's call runs LAST wins
  // for the rest of the process — that static `{ grpc_client: {} }` (no `.core`) is the EXACT undefined-read
  // shape below, permanently overriding this file's own `set_expedition_sdk_mock(throwing_sdk)` for whichever
  // file ran after world_checkpoint.test.js. Fixed at the source: that file now routes through
  // set_expedition_sdk_mock/reset_expedition_sdk_mock like every other consumer instead of a second direct
  // mock.module call.
  test('throwing RPC → honest toast + technical game_log detail, with no raw JSON in player copy', async () => {
    const buy = buy_items_sale({
      sale_id: '0xsale',
      template_id: '0xtemplate',
      price_mist: '1000000',
    })

    const refusal = await use_toast
      .getState()
      .promise(buy, { pending: 'Buying…' })
      .catch((error) => error)

    expect(refusal).toBeInstanceOf(Error)
    expect(refusal.cause).toBe(RPC_REFUSAL)

    const error_toast = [...use_toast.getState().toasts].reverse().find((toast) => toast.type === 'error')
    expect(error_toast?.message).toBe(HONEST_TOAST)
    expect(error_toast?.message).not.toContain(RPC_REFUSAL.code)
    expect(error_toast?.message).not.toContain(RPC_REFUSAL.detail.request_id)

    const lookup_log = get_log_buffer().find(
      (entry) => entry.ns === 'buy' && entry.message.includes('kiosk lookup failed')
    )
    expect(lookup_log?.message).toContain(RPC_REFUSAL.code)
    expect(lookup_log?.message).toContain(RPC_REFUSAL.detail.request_id)
  })

  test('the kiosk-lookup copy exists in all six locales', () => {
    for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
      const messages = JSON.parse(readFileSync(new URL(`../i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
      expect(messages.errors?.kiosk_lookup_failed).toBeString()
      expect(messages.errors.kiosk_lookup_failed.length).toBeGreaterThan(0)
    }
  })
})
