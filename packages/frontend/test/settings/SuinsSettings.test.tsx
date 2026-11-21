// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import * as store from '../../src/store.ts'
import { initial_suins_state, reduce_suins, type SuinsState } from '../../src/modules/suins.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { SuinsSettings } from '../../src/settings/SuinsSettings.tsx'

const names = [{ name: 'sceat.sui', object_id: '0x3', nft_id: '0x3', subname: false }]
const apply_button = async (suins: SuinsState) => {
  const state = {
    ...store.read_app_state(),
    session: { ...store.read_app_state().session, wallet: { address: '0x1', suins: { managed: true } } },
    suins,
  } as store.AppState
  const selected = spyOn(store, 'useAppStore').mockImplementation((selector) => selector(state))
  try {
    const markup = renderToStaticMarkup(<SuinsSettings copy={await load_app_copy('en')} />)
    const button = /<button[^>]*type="submit"[^>]*>/.exec(markup)
    expect(button).not.toBeNull()
    return { disabled: button![0].includes('disabled') }
  } finally {
    selected.mockRestore()
  }
}

// Regression (production, 2026-11-21): Apply stayed live for the name that was just applied, and
// asked the player to confirm a change that signed nothing.
test('Apply is disabled for the applied name and live again for another name or after a reset', async () => {
  const loaded = { ...initial_suins_state(), snapshot: { default_name: null, names }, draft: 'sceat.sui' }
  expect(await apply_button(loaded)).toEqual({ disabled: false })
  const requested = reduce_suins(loaded, { type: 'suins/use' })
  const applied = reduce_suins(requested, { type: 'suins/used', request: requested.request as never, pending: null })
  expect(await apply_button(applied)).toEqual({ disabled: true })
  const other = reduce_suins(applied, { type: 'suins/name_changed', name: 'other.sui' })
  expect(await apply_button(other)).toEqual({ disabled: false })
  expect(await apply_button(reduce_suins(other, { type: 'suins/name_changed', name: 'sceat.sui' }))).toEqual({
    disabled: true,
  })
  const reset = reduce_suins(applied, { type: 'suins/reset' })
  expect(await apply_button({ ...reset, snapshot: loaded.snapshot, draft: 'sceat.sui' })).toEqual({ disabled: false })
})

test('a missing agent default keeps Apply live for the same name', async () => {
  const loaded = { ...initial_suins_state(), snapshot: { default_name: null, names }, draft: 'sceat.sui' }
  const requested = reduce_suins(loaded, { type: 'suins/use' })
  const pairing = { address: '0x2', multisig_public_key: 'fixture', signer_mode: 'host-persistent' } as never
  const partial = reduce_suins(requested, {
    type: 'suins/used',
    request: requested.request as never,
    pending: { pairing, reason: 'funding' },
  })
  expect(await apply_button(partial)).toEqual({ disabled: false })
})
