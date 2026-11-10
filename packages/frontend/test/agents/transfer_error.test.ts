// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'
import { transaction_resolution_error, pre_submission_failure } from '@aresrpg/sdk/transaction-error'

import { agent_transfer_error, agent_transfer_needs_gas } from '../../src/agents/transfer_error.ts'
import { failure_copy_key } from '../../src/i18n/player_error.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'

const copy = {
  ui: {},
  airdrop_page: {},
  kares_page: { error_generic: 'Generic', error_funds: 'Add funds', error_rejected: 'Signature rejected' },
} as unknown as AppCopy
test('a failed post-offer claim retains its actual cause instead of the removed collection instructions', () => {
  const cause = new Error('Royalty policy refused this item')
  const original = new AgentHandoverIncomplete(cause, 'offer-digest')
  const error = agent_transfer_error(copy, original)
  expect(error.message).toBe(cause.message)
  expect(error.cause).toBe(original)
  expect(agent_transfer_needs_gas(original)).toBe(false)
  expect(
    agent_transfer_error(copy, new AgentHandoverIncomplete(new Error('GasBalanceTooLow: insufficient funds'), 'offer'))
      .message
  ).toBe('Add funds')
})
test('known executed and uncertain outcomes can never become an unsubmitted zero-cost gas refusal', () => {
  for (const message of [
    '[sdk] transaction D failed on-chain: gas budget exceeded',
    '[sdk] transaction outcome unknown: D; gas budget unavailable',
    '[sdk] previous transaction recovered: D',
  ]) {
    const error = new Error(message)
    expect(transaction_resolution_error(error)).toBe(error)
    expect(pre_submission_failure(error)).toBe(false)
    expect(failure_copy_key(message)).not.toBe('gas_budget_toast')
  }
})
