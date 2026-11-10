// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { same_hosted_bot, type HostedBotDescriptor, type HostedReturnResponse } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-pairing'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'
import { AgentReturnFundingRequired } from '@aresrpg/sdk/agent-return'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { read_app_state, dispatch_app, subscribe_app } from '../store.ts'
import { env } from '../env.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import {
  authenticate_hosted,
  cancel_hosted_session,
  create_hosted_client,
  current_wallet,
  pause_hosted_request,
} from './hosted_client.ts'
import { read_return_projection } from './return_projection.ts'
import { agent_transfer_error } from './transfer_error.ts'

/** Stop authority first. The existing SDK owns all custody, fees, signatures and transaction recovery. */
export const disconnect_agent = async (wallet: AuthSession, bot: HostedBotDescriptor, copy: AppCopy): Promise<void> => {
  const current = read_app_state().session
  if (current.wallet !== wallet || current.agent_connection.phase === 'returning') return
  dispatch_app({ type: 'agent/return_running', wallet, active: true })
  const controller = new AbortController()
  const client = create_hosted_client(env.bot_service_url, controller.signal, {
    get_state: read_app_state,
    dispatch: dispatch_app,
  })
  const pairing = {
    address: bot.address,
    multisig_public_key: bot.multisig_public_key,
    signer_mode: 'disposable' as const,
  }
  const before_sign = () => {
    current_wallet(wallet, client)
    owner_agent_identity(pairing, wallet.read_agent_pairing_request?.(crypto.randomUUID()))
  }
  const stop = subscribe_app((state) => {
    if (state.session.wallet !== wallet) controller.abort()
  })
  const notification = toast.loading(copy.ui.agent_returning)
  let authorization_id: string | null = null
  try {
    before_sign()
    const authentication = await authenticate_hosted(client, wallet, null, (id) => {
      authorization_id = id
    })
    ;({ authorization_id } = authentication)
    const begin = async (review: HostedBotDescriptor) => {
      const result = await client.request<HostedReturnResponse>('/connect/disconnect', {
        authorization_id,
        bot: review,
      })
      before_sign()
      const generation = review.status === 'returning' ? review.generation : review.generation + 1
      if (!same_hosted_bot({ ...review, generation, status: 'returning' }, result.bot))
        throw new Error('The return destination changed.')
      return result
    }
    let stopped = await begin(bot)
    dispatch_app({ type: 'agent/return_updated', wallet, bot: stopped.bot })
    while (stopped.phase === 'draining') {
      await pause_hosted_request(controller.signal)
      stopped = await begin(stopped.bot)
    }
    if (stopped.phase !== 'stopped') throw new Error('Bot return is unavailable.')
    await run_direct_transaction.when_idle()
    const operation = run_direct_transaction(async () => {
      await wallet.return_agent_assets(pairing, {
        before_sign,
        guard: async () => {
          if ((await begin(stopped.bot)).phase !== 'stopped') throw new Error('The bot has an unresolved transaction.')
        },
        read_projection: (accept) => read_return_projection(wallet, pairing, accept),
      })
      const finished = await client.request<HostedReturnResponse>('/connect/return-complete', {
        authorization_id,
        bot: stopped.bot,
      })
      before_sign()
      if (finished.phase !== 'complete' || !same_hosted_bot({ ...stopped.bot, status: 'ready' }, finished.bot))
        throw new Error('Return completion could not be confirmed.')
      dispatch_app({ type: 'agent/return_updated', wallet, bot: finished.bot })
      dispatch_app({ type: 'wallet/refresh' })
    })
    if (!operation) throw new Error('Another wallet transaction is in progress.')
    await operation
    notification.success(copy.ui.agent_return_complete)
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- The retained loading toast reports the failure below.
  } catch (error) {
    notification.error(agent_transfer_error(copy, error))
    if (read_app_state().session.wallet !== wallet) return
    const cause = error instanceof AgentHandoverIncomplete ? error.cause : error
    if (cause instanceof AgentReturnFundingRequired) dispatch_app({ type: 'funding/open', cost_mist: cause.cost_mist })
  } finally {
    stop()
    dispatch_app({ type: 'agent/return_running', wallet, active: false })
    controller.abort()
    if (authorization_id) void cancel_hosted_session(env.bot_service_url, authorization_id).catch(console.warn)
  }
}
