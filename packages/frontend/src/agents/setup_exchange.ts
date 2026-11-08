// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AGENT_SETUP_PATH, type AgentPairingIdentity } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import { env } from '../env.ts'

import type { SetupExchange } from './setup_requests.ts'
import type { PairingInput } from './pairing_state.ts'

const wait_for_status = (signal: Readonly<AbortSignal>) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 2_000)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
export const setup_link = (id: string, token: string, endpoint = env.server_ws_url): string => {
  const url = new URL(AGENT_SETUP_PATH, endpoint.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'))
  return `${url.href}?${new URLSearchParams({ id })}#${token}`
}

/** One sequential exchange. Cancellation waits for any in-flight status before sending cancel. */
export const run_agent_setup = async (
  wallet: AuthSession,
  public_identifier: string,
  attempt: number,
  exchange: SetupExchange,
  signal: Readonly<AbortSignal>,
  report: (input: PairingInput) => void
): Promise<AgentPairingIdentity> => {
  // One in-memory capability per attempt makes duplicate begin requests idempotent.
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  const begun = await exchange(wallet, { action: 'begin', public_identifier, token })
  if (begun.action !== 'begin') throw new Error('SETUP_UNAVAILABLE')
  const { pairing_id } = begun
  try {
    signal.throwIfAborted()
    report({ type: 'link', attempt, link: setup_link(pairing_id, begun.token) })
    let identity: AgentPairingIdentity | null = null
    while (!identity) {
      await wait_for_status(signal)
      signal.throwIfAborted()
      const result = await exchange(wallet, { action: 'status', pairing_id, token })
      if (result.action !== 'status') throw new Error('SETUP_UNAVAILABLE')
      ;({ identity } = result)
    }
    signal.throwIfAborted()
    return identity
  } finally {
    await exchange(wallet, { action: 'cancel', pairing_id, token }).then(
      (result) => {
        if (result.action !== 'cancel')
          console.warn('Agent setup is already unavailable; its server expiry still applies.')
      },
      () => console.warn('Agent setup cancellation could not be confirmed; its server expiry still applies.')
    )
  }
}
