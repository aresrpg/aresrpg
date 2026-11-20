// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { WalletImportPlan } from '@aresrpg/sdk/wallet-import'

import type { AuthSession } from '../../src/auth.ts'
import type { AppInput } from '../../src/store.ts'
import {
  initial_wallet_import_state,
  reduce_wallet_import,
  type WalletImportInput,
  type WalletImportState,
} from '../../src/modules/wallet_import.ts'

const source = { address: '0x2', wallet_name: 'Slush' } as AuthSession
const other = { address: '0x3', wallet_name: 'Slush' } as AuthSession
const plan = {
  characters: [],
  items: [],
  pending: { characters: [], items: [] },
  left: { roster: 1, listed: 0 },
  assets: 3,
  royalty_mist: 3_000_000n,
} as WalletImportPlan

const fold = (inputs: readonly AppInput[], connected: AuthSession | null = source): WalletImportState =>
  inputs.reduce((state, input) => reduce_wallet_import(state, input, connected), initial_wallet_import_state())

const open: WalletImportInput = { type: 'wallet_import/open' }
const loaded: readonly WalletImportInput[] = [open, { type: 'wallet_import/loaded', source, plan }]

test('opening without a connected source wallet waits for a connection', () => {
  expect(fold([open], null)).toMatchObject({ open: true, source: null, pending: null })
})

test('an open window reads the connected wallet, and reads again when another wallet replaces it', () => {
  const first = fold([open])
  expect(first).toMatchObject({ source, pending: 'load' })
  const read = reduce_wallet_import(first, { type: 'wallet_import/loaded', source, plan }, source)
  expect(read).toMatchObject({ pending: null, plan })
  const replaced = reduce_wallet_import(read, { type: 'external_wallet/disconnect' }, other)
  expect(replaced).toMatchObject({ source: other, pending: 'load', plan: null })
  expect(reduce_wallet_import(replaced, { type: 'external_wallet/disconnect' }, null)).toMatchObject({
    source: null,
    pending: null,
    plan: null,
  })
})

test('a snapshot of a wallet that is no longer the connected source is dropped', () => {
  const state = fold([open, { type: 'wallet_import/loaded', source: other, plan }])
  expect(state).toMatchObject({ pending: 'load', plan: null })
})

test('a closed window ignores wallet connections', () => {
  expect(fold([{ type: 'external_wallet/disconnect' }])).toEqual(initial_wallet_import_state())
})

test('a running import cannot be closed, restarted, re-read or moved to another wallet', () => {
  const running = fold([...loaded, { type: 'wallet_import/running' }])
  expect(running.pending).toBe('import')
  expect(reduce_wallet_import(running, { type: 'wallet_import/close' }, source)).toBe(running)
  expect(reduce_wallet_import(running, { type: 'wallet_import/running' }, source)).toBe(running)
  expect(reduce_wallet_import(running, { type: 'wallet_import/refresh' }, source)).toBe(running)
  expect(reduce_wallet_import(running, { type: 'external_wallet/disconnect' }, other)).toBe(running)
})

test('an import cannot run before the wallet was read', () => {
  expect(fold([open, { type: 'wallet_import/running' }]).pending).toBe('load')
})

test('a failure ends the run, keeps the snapshot and shows the reason; a retry reads again', () => {
  const error = { kind: 'funding', payer: 'source', required_mist: 5n } as const
  const failed = fold([...loaded, { type: 'wallet_import/running' }, { type: 'wallet_import/failed', error }])
  expect(failed).toMatchObject({ pending: null, plan, error, done: null, progress: null })
  expect(reduce_wallet_import(failed, { type: 'wallet_import/refresh' }, source)).toMatchObject({
    pending: 'load',
    plan: null,
    error: null,
  })
})

test('a finished import reports the moved count and what stayed in the wallet', () => {
  const progress = { signer: 'owner', moved: 3, total: 3 } as const
  const finished = fold([
    ...loaded,
    { type: 'wallet_import/running' },
    { type: 'wallet_import/progress', progress },
    { type: 'wallet_import/finished', plan },
  ])
  expect(finished).toMatchObject({
    pending: null,
    plan: null,
    progress: null,
    done: { moved: 3, left: { roster: 1, listed: 0 } },
  })
})

test('closing resets the window state', () => {
  expect(fold([...loaded, { type: 'wallet_import/close' }])).toEqual(initial_wallet_import_state())
})
