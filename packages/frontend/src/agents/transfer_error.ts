// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AgentReturnFundingRequired } from '@aresrpg/sdk/agent-return'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'

import type { AppCopy } from '../i18n/copy.ts'
import { gas_empty_error } from '../toast.ts'
import { localized_error } from '../i18n/error_text.ts'
import { player_error_text } from '../i18n/player_error.ts'

export const agent_transfer_error = (copy: AppCopy, error: unknown): Error =>
  localized_error(
    error instanceof AgentReturnFundingRequired
      ? copy.ui.agent_return_needs_sui
      : error instanceof AgentHandoverIncomplete
        ? copy.ui.agent_claim_pending
        : player_error_text(copy, error),
    error
  )

export const agent_transfer_needs_gas = (error: unknown): boolean =>
  gas_empty_error(error instanceof AgentHandoverIncomplete ? error.cause : error)
