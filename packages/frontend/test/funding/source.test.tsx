// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { transaction_resolution_error } from '@aresrpg/sdk/transaction-error'
import { renderToStaticMarkup } from 'react-dom/server'

import { funding_owner_source, funding_source_current, selected_funding_source } from '../../src/funding/source.ts'
import { agent_funding_authorization } from '../../src/funding/recipient.ts'
import { send_sui_source, payment_uncertain } from '../../src/funding/useFundingCheckout.ts'
import { initial_checkout, reduce_checkout, checkout_locked } from '../../src/funding/checkout_state.ts'
import { FundingSources } from '../../src/funding/FundingSources.tsx'
import { automation_fixture, character } from '../modules/automation_fixture.ts'
import { external_wallet_view } from '../../src/wallet/view.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import type { AuthSession } from '../../src/auth.ts'

const fixture = () => {
  const app = automation_fixture()
  const pairing = { address: 'agent', multisig_public_key: 'key', signer_mode: 'host-persistent' as const }
  const session = {
    ...app.session,
    wallet: { ...app.session.wallet!, identity: 'zklogin' as const },
    selected_character_id: 'remote',
    agent_view: {
      ...app.session.agent_view,
      status: 'ready' as const,
      characters: [{ ...character(), id: 'remote' }],
      request: { pairing, public_identifier: 'google', character_id: 'remote' },
    },
  }
  return { ...app, session }
}
test('own Google wallet is a source only for the current authorized agent, never self funding', () => {
  const app = fixture(),
    authorization = agent_funding_authorization(app.session)!
  expect(funding_owner_source(app.session, 'agent', authorization)).toBe(app.session.wallet)
  expect(selected_funding_source(app.session.wallet, null, false)).toBe(app.session.wallet)
  expect(selected_funding_source(app.session.wallet, null, true)).toBeNull()
  expect(selected_funding_source(null, app.session.wallet, false)).toBe(app.session.wallet)
  expect(funding_source_current(app, app.session.wallet, 'agent', authorization)).toBe(true)
  expect(funding_owner_source(app.session, 'agent')).toBeNull()
  expect(funding_owner_source(app.session, 'owner', authorization)).toBeNull()
  const changed = { ...app, session: { ...app.session, wallet: { ...app.session.wallet } } }
  expect(funding_source_current(changed, app.session.wallet, 'agent', authorization)).toBe(false)
  expect(funding_owner_source(changed.session, 'agent', authorization)).toBeNull()
  expect(
    funding_owner_source(
      { ...app.session, agent_view: { ...app.session.agent_view, serial: 99 } },
      'agent',
      authorization
    )
  ).toBeNull()
  expect(
    funding_source_current(
      { ...app, external_wallet: { ...app.external_wallet, session: app.session.wallet } },
      app.session.wallet,
      'owner'
    )
  ).toBe(true)
})
test('own wallet is the first funding option with its balance, and external providers remain selectable', async () => {
  const app = fixture(),
    copy = await load_app_copy('en')
  const render = (external: boolean) =>
    renderToStaticMarkup(
      <FundingSources
        owner={app.session.wallet}
        balance={1239999999n}
        external={external}
        select_external={() => undefined}
        wallet={external_wallet_view(app.external_wallet)}
        copy={copy}
        locked={false}
      />
    )
  const own = render(false)
  expect(own.indexOf(copy.ui.funding_game_wallet)).toBeLessThan(own.indexOf(copy.ui.funding_external_wallet))
  expect(own).toContain('1.23 SUI')
  expect(own).not.toContain('data-wallet-sources')
  expect(render(true)).toContain('data-wallet-sources')
})
test('direct funding checks amount plus gas and preserves destination and the final signing guard', async () => {
  let balance = 100n,
    sent = 0,
    current = true
  const wallet = {
    read_sui_balance: async () => balance,
    estimate_sui_transfer: async () => 10n,
    send_sui: async (recipient: string, amount: bigint, drain: boolean, before_sign?: () => void) => {
      await Promise.resolve()
      before_sign?.()
      expect([recipient, amount, drain]).toEqual(['agent', 90n, false])
      sent += 1
      return { digest: 'certified' }
    },
  } as unknown as AuthSession
  const guard = () => {
    if (!current) throw new Error('funding_source_changed')
  }
  balance = 89n
  await expect(send_sui_source(wallet, 'agent', 90n, guard)).rejects.toThrow('funding_source_balance')
  balance = 99n
  await expect(send_sui_source(wallet, 'agent', 90n, guard)).rejects.toThrow('funding_source_gas')
  expect(sent).toBe(0)
  balance = 100n
  expect(await send_sui_source(wallet, 'agent', 90n, guard)).toBe('certified')
  current = false
  await expect(send_sui_source(wallet, 'agent', 90n, guard)).rejects.toThrow('funding_source_changed')
  expect(sent).toBe(1)
})

test('source replacement before signing cancels locally; a signed attempt still reports its outcome', async () => {
  const app = fixture(),
    authorization = agent_funding_authorization(app.session)!
  let current = app
  let state = reduce_checkout(initial_checkout(), { type: 'stage', stage: 'preparing', amount_text: '1' })
  const { promise, resolve } = Promise.withResolvers<bigint>()
  let signed = 0
  const wallet = {
    ...app.session.wallet,
    read_sui_balance: () => promise,
    estimate_sui_transfer: async () => 1n,
    send_sui: async (_recipient: string, _amount: bigint, _drain: boolean, guard?: () => void) => {
      guard?.()
      signed += 1
      return { digest: 'receipt' }
    },
  } as AuthSession
  const guard = () => {
    if (!funding_source_current(current, app.session.wallet, 'agent', authorization))
      throw new Error('funding_source_changed')
  }
  const attempt = send_sui_source(wallet, 'agent', 1n, guard).catch((error: Error) => {
    state = reduce_checkout(state, { type: 'error', error: error.message, uncertain: false })
  })
  current = { ...app, session: { ...app.session, wallet: { ...app.session.wallet } } }
  resolve(10n)
  await attempt
  expect(state.stage).toBe('failed')
  expect(checkout_locked(state)).toBe(false)
  expect(signed).toBe(0)
  const pending = reduce_checkout(initial_checkout(), { type: 'stage', stage: 'signing', amount_text: '1' })
  const replaced = reduce_checkout(pending, { type: 'assets_loading', source: wallet })
  expect(reduce_checkout(replaced, { type: 'reset' })).toBe(replaced)
  const receipt = reduce_checkout(replaced, { type: 'submitted', transaction: 'receipt', at: 1 })
  expect(reduce_checkout(receipt, { type: 'observed', status: 'success' }).stage).toBe('success')
  const uncertain = reduce_checkout(replaced, { type: 'error', error: 'timeout', uncertain: true })
  expect(uncertain.stage).toBe('unknown')
  expect(checkout_locked(uncertain)).toBe(true)
})

test('an SDK-proven unsigned cancellation unlocks even after a preliminary signing guard', () => {
  const cancelled = transaction_resolution_error(new Error('funding_source_changed'))
  expect(payment_uncertain(cancelled, true)).toBe(false)
  expect(payment_uncertain(new Error('RPC response lost'), true)).toBe(true)
  expect(payment_uncertain(new Error('funding_source_balance'), false)).toBe(false)
  expect(payment_uncertain({ code: 4001 }, true)).toBe(false)
})

test('both SDK guard calls preserve unsigned cancellation through checkout error classification', async () => {
  const { promise: session_loaded, resolve: finish_session } = Promise.withResolvers<void>()
  const { promise: preparing, resolve: prepared } = Promise.withResolvers<void>()
  let current = true,
    submitted = false,
    signatures = 0
  let state = reduce_checkout(initial_checkout(), { type: 'stage', stage: 'preparing', amount_text: '1' })
  const wallet = {
    read_sui_balance: async () => 10n,
    estimate_sui_transfer: async () => 1n,
    send_sui: async (_recipient: string, _amount: bigint, _drain: boolean, guard?: () => void) => {
      try {
        guard?.()
        prepared()
        await session_loaded
        guard?.()
        signatures += 1
        return { digest: 'unused' }
      } catch (error) {
        throw transaction_resolution_error(error)
      }
    },
  } as unknown as AuthSession
  const attempt = send_sui_source(wallet, 'agent', 1n, () => {
    if (!current) throw new Error('funding_source_changed')
    submitted = true
    state = reduce_checkout(state, { type: 'stage', stage: 'signing', amount_text: '1' })
  }).catch((error: Error) => {
    state = reduce_checkout(state, {
      type: 'error',
      error: error.message,
      uncertain: payment_uncertain(error, submitted),
    })
  })
  await preparing
  current = false
  finish_session()
  await attempt
  expect(submitted).toBe(true)
  expect(signatures).toBe(0)
  expect(state.stage).toBe('failed')
  expect(checkout_locked(state)).toBe(false)
})
