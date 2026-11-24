// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The signed-in wallet's reads: its balances, on a timer and on focus, and the owner of a character name.
import type { ClientPacket } from '@aresrpg/protocol'

import type { SiteContext } from '../store.ts'

const BALANCE_POLL_MS = 5_000

type CharacterRequest = Readonly<{
  character_id: string
  timeout: ReturnType<typeof setTimeout>
  resolve: (recipient: Readonly<{ address: string; name: string }>) => void
  reject: (error: Readonly<Error>) => void
}>
/** Name lookups wait for the server's answer by request id; a link that ends fails the ones still waiting. */
export const observe_character_requests = (
  { events, get_state, next_request_id }: SiteContext,
  send: (packet: Readonly<ClientPacket>) => boolean
) => {
  const requests = new Map<number, CharacterRequest>()
  const settle = (id: number): CharacterRequest | undefined => {
    const request = requests.get(id)
    if (request) clearTimeout(request.timeout)
    requests.delete(id)
    return request
  }
  events.on('wallet/resolve_character', ({ name, resolve, reject }) => {
    const connected = get_state().session.wallet
    if (!connected) return reject(new Error('The wallet session is unavailable'))
    try {
      const character_id = connected.derive_character_id(name)
      const id = next_request_id()
      const timeout = setTimeout(() => settle(id)?.reject(new Error('The character lookup timed out')), 15_000)
      requests.set(id, Object.freeze({ character_id, timeout, resolve, reject }))
      if (send({ type: 'packet/character_owner_request', id, character_id })) return
      settle(id)
      reject(new Error('The game server is unavailable'))
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  events.on('server/packet', ({ packet }) => {
    if (packet.type === 'packet/character_owner_response') {
      if (requests.get(packet.id)?.character_id !== packet.character_id) return
      settle(packet.id)?.resolve(Object.freeze({ address: packet.owner, name: packet.name }))
    }
    if (packet.type === 'packet/error' && packet.id !== undefined) settle(packet.id)?.reject(new Error(packet.reason))
  })
  return (): void => {
    for (const id of [...requests.keys()]) settle(id)?.reject(new Error('The wallet session ended'))
  }
}
export const observe_wallet_balances = ({ events, dispatch, get_state, signal }: SiteContext) => {
  let balance_request_id = 0
  const refresh_wallet = (): void => {
    const { wallet: connected, inventory_pairing: pairing } = get_state().session
    if (!connected) return
    balance_request_id += 1
    const request_id = balance_request_id
    const current = (): boolean => request_id === balance_request_id && connected === get_state().session.wallet
    void Promise.all([connected.read_sui_balance(), connected.read_kares_balance()])
      .then(([balance_mist, kares_balance]) => {
        if (current())
          dispatch({ type: 'wallet/refreshed', balance_mist, kares_balance, gas_spent_mist: connected.gas_spent_24h() })
      })
      .catch((error) => console.warn('Wallet balance could not be refreshed.', error))
    if (pairing)
      void connected
        .read_agent_balances(pairing)
        .then((balances) => {
          if (current()) dispatch({ type: 'agent/inventory_balances', wallet: connected, pairing, ...balances })
        })
        .catch((error) => console.warn('Agent balance could not be refreshed.', error))
  }
  events.on('wallet/refresh', refresh_wallet)
  const balance_timer = setInterval(refresh_wallet, BALANCE_POLL_MS)
  const refresh_on_focus = (): void => {
    if (globalThis.document?.visibilityState !== 'hidden') dispatch({ type: 'wallet/refresh' })
  }
  globalThis.addEventListener('focus', refresh_on_focus, { signal })
  globalThis.document?.addEventListener('visibilitychange', refresh_on_focus, { signal })
  signal.addEventListener('abort', () => clearInterval(balance_timer), { once: true })
  return refresh_wallet
}
