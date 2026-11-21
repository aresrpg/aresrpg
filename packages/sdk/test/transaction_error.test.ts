// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { transaction_failure_kind } from '../src/transaction_error.ts'

const not_submitted = (cause: string) => new Error(`[sdk] transaction resolution failed — NOT submitted: ${cause}`)

// The fullnode's own sentence: sui-rpc-api `error.rs:494-503`, Sui 1.84.1 (rev e83d690), read 2026-11-21.
// A hosted run whose wallet could not pay reported `command_failed` forever, because the word SUI sits
// between "insufficient" and "balance" and the classifier did not expect it.
const NODE_SENTENCE =
  'Unable to perform gas selection due to insufficient SUI balance (in address balance or coins) for account 0x1 to satisfy required budget 5000000.'

test('a wallet that cannot pay the fees is a funding wait, in every wording the node uses', () => {
  for (const cause of [
    NODE_SENTENCE,
    'insufficient balance',
    'InsufficientGas',
    'not enough SUI',
    'No valid gas coins found for the transaction.',
  ])
    expect(transaction_failure_kind(not_submitted(cause))).toBe('funding')
})

test('a funding wording after submission, or any other failure, is never a funding wait', () => {
  expect(transaction_failure_kind(new Error(NODE_SENTENCE))).toBe('failed')
  expect(transaction_failure_kind(not_submitted('MoveAbort in fight::start'))).toBe('failed')
  expect(transaction_failure_kind(new Error('[sdk] transaction outcome unknown: timeout'))).toBe('uncertain')
})
