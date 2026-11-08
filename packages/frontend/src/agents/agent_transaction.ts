// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  AgentTransferActions,
  AgentTransferIntent,
  AgentTransferReview,
} from '@aresrpg/sdk/agent-transfer-actions'
import { transaction_resolution_error } from '@aresrpg/sdk/transaction-error'

/** One explicit gesture prepares and submits one transaction, retaining the wallet's signature approval. */
export const execute_agent_transfer = async ({
  actions,
  intent,
  is_current,
  prepared,
}: Readonly<{
  actions: AgentTransferActions
  intent: AgentTransferIntent
  is_current: () => boolean
  prepared?: () => void
}>) => {
  const assert_current = () => {
    if (!is_current()) throw new Error('The confirmed wallet or agent changed.')
  }
  let review: AgentTransferReview
  try {
    assert_current()
    review = await actions.prepare(intent)
    assert_current()
    prepared?.()
  } catch (error) {
    throw transaction_resolution_error(error)
  }
  // Never wrap a confirmation error as preflight failure or retry an uncertain/executed transaction.
  return review.confirm({ before_sign: assert_current })
}
