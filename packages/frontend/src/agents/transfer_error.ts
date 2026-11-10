// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AgentReturnFundingRequired } from '@aresrpg/sdk/agent-return'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'

import type { AppCopy } from '../i18n/copy.ts'
import { gas_empty_error } from '../toast.ts'
import { localized_error } from '../i18n/error_text.ts'
import { player_error_text } from '../i18n/player_error.ts'

export const agent_transfer_error = (copy: AppCopy, error: unknown): Error => {
  const cause = error instanceof AgentHandoverIncomplete ? error.cause : error
  const translated =
    cause instanceof AgentReturnFundingRequired ? copy.ui.agent_return_needs_sui : player_error_text(copy, cause)
  const message =
    translated === copy.kares_page.error_generic && cause instanceof Error
      ? cause.message.replace(/^\[sdk\] transaction resolution failed — NOT submitted: /, '')
      : translated
  return localized_error(message, error)
}

export const agent_transfer_needs_gas = (error: unknown): boolean => {
  const cause = error instanceof AgentHandoverIncomplete ? error.cause : error
  if (cause instanceof Error && cause.message.startsWith('[sdk] gas budget exceeded')) return false
  return gas_empty_error(cause)
}
