// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentTransferReview } from '@aresrpg/sdk/agent-transfer-actions'

import { AgentReturnReview } from '../../src/agents/AgentReturnReview.tsx'
import type { AuthSession } from '../../src/auth.ts'
import {
  AgentTransferOutcome,
  reduce_transfer_review,
  can_check_transfer,
} from '../../src/agents/AgentTransferReview.tsx'

const copy = {
  ui: {
    agent_transfer_gas: 'Gas',
    agent_transfer_step: 'One step only',
    agent_transfer_confirm: 'Confirm',
    agent_transfer_signer_missing: 'Persistent signer required',
    agent_transfer_failed: 'Check the outcome',
    agent_transfer_receipt: 'Receipt',
  },
}
const never_confirm = () => {
  throw new Error('Rendering must not sign')
}

test('disposable review displays estimate but cannot offer enabled confirmation', () => {
  const html = renderToStaticMarkup(
    <AgentTransferOutcome
      copy={copy}
      allow_submit={false}
      confirm={never_confirm}
      state={{ phase: 'review', review: { network: 'mainnet', gas_mist: '13' } as AgentTransferReview }}
    />
  )
  expect(html).toContain('disabled')
  expect(html).toContain('Persistent signer required')
  expect(html).toContain('13 MIST')
})
test('completed receipt and failed outcome expose no confirmation control', () => {
  for (const state of [{ phase: 'done' as const, digest: 'certified-digest' }, { phase: 'failed' as const }]) {
    const html = renderToStaticMarkup(
      <AgentTransferOutcome copy={copy} allow_submit confirm={never_confirm} state={state} />
    )
    expect(html).not.toContain('<button')
    expect(html).toContain(state.phase === 'done' ? 'certified-digest' : 'Check the outcome')
  }
})

test('return review requires address comparison before preflight and rejects a foreign recipient', () => {
  const offer = {
    character_id: 'character',
    character_name: 'Test character',
    seller_kiosk: 'kiosk',
    purchase_cap: 'cap',
    recipient: 'human',
    agent_address: 'agent',
  }
  const wallet = { address: 'human' } as AuthSession
  const full_copy = copy as unknown as import('../../src/i18n/copy.ts').AppCopy
  const html = renderToStaticMarkup(<AgentReturnReview wallet={wallet} offer={offer} copy={full_copy} />)
  expect(html).toContain('type="checkbox"')
  expect(html).not.toContain('checked=""')
  expect(html).not.toContain('data-agent-transfer-review')
  expect(
    renderToStaticMarkup(
      <AgentReturnReview wallet={wallet} offer={{ ...offer, recipient: 'other' }} copy={full_copy} />
    )
  ).toBe('')
})

test('uncertain submission keeps the recovery digest visible without retry', () => {
  const error =
    '[sdk] transaction outcome unknown: public-transaction-digest; check this transaction before trying again'
  const html = renderToStaticMarkup(
    <AgentTransferOutcome copy={copy} allow_submit confirm={never_confirm} state={{ phase: 'failed', error }} />
  )
  expect(html).toContain('public-transaction-digest')
  expect(html).toContain('outcome unknown')
  expect(html).not.toContain('<button')
})

test('transient preflight failure can be checked again but uncertain submission cannot', () => {
  const failure = reduce_transfer_review({ phase: 'preparing' }, { type: 'preflight_failed', error: 'RPC unavailable' })
  expect(can_check_transfer(failure.phase)).toBe(true)
  const retry = reduce_transfer_review(failure, { type: 'prepare' })
  expect(retry.phase).toBe('preparing')
  expect(retry.error).toBeUndefined()
  expect(can_check_transfer(retry.phase)).toBe(false)
  const uncertain = reduce_transfer_review(
    { phase: 'submitting' },
    { type: 'failed', error: 'outcome unknown: digest' }
  )
  expect(can_check_transfer(uncertain.phase)).toBe(false)
  expect(uncertain.error).toContain('digest')
})
