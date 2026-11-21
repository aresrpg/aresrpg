// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'

import { env, type PublicEnv } from '../env.ts'
import { dispatch_app, read_app_state } from '../store.ts'

import { create_hosted_client, read_hosted_request } from './hosted_client.ts'
import { telegram_request } from './silent_consent.ts'

/** Only a request, on a build that knows both peer addresses, can be a Telegram chat's login. */
export const telegram_possible = (
  authorization_id: string | null,
  service: Pick<PublicEnv, 'bot_service_url' | 'telegram_callback_url'> = env
): authorization_id is string =>
  authorization_id !== null && service.telegram_callback_url !== '' && service.bot_service_url !== ''

/**
 * Whether the request in the address returns to our Telegram service: `null` while the bot is asked.
 * The bot's own description of the request decides, read before anything is signed: an address can be
 * forged, the redirect the bot registered cannot. No request, no configured callback or a failed read
 * all answer `false`, and the page then waits for the player as it does for any assistant.
 */
export const useTelegramRequest = (authorization_id: string | null): boolean | null => {
  const asked = telegram_possible(authorization_id)
  const [answer, set_answer] = useState<boolean | null>(asked ? null : false)
  useEffect(() => {
    if (!telegram_possible(authorization_id)) return
    const controller = new AbortController()
    const client = create_hosted_client(env.bot_service_url, controller.signal, {
      get_state: read_app_state,
      dispatch: dispatch_app,
    })
    void read_hosted_request(client, authorization_id).then(
      (request) => {
        if (!controller.signal.aborted) set_answer(telegram_request(request, env.telegram_callback_url))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        console.warn('The hosted request could not be read; it waits for the player.', error)
        set_answer(false)
      }
    )
    return () => controller.abort()
  }, [authorization_id])
  return answer
}
