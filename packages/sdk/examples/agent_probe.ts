// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { parse_server_packet } from '@aresrpg/protocol'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

type ProbeInput = Readonly<{ endpoint: string; origin: string; address: string }>
type BunSocketConstructor = new (url: string, options: Readonly<{ headers: Readonly<{ Origin: string }> }>) => WebSocket
const root_url = (url: URL) => url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
const PROBE_TIMEOUT_MS = 5_000

const probe_url = ({ endpoint, address, origin }: ProbeInput): string => {
  const url = new URL(endpoint)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)) throw new Error('Use WSS or loopback WS.')
  if (!root_url(url)) throw new Error('Expected a root WebSocket URL without credentials or parameters.')
  if (new URL(origin).origin !== origin) throw new Error('Expected an explicit Origin.')
  if (!isValidSuiAddress(address)) throw new Error('Expected a public Sui address.')
  url.searchParams.set('address', normalizeSuiAddress(address))
  return url.href
}

/** Bun-only, bounded transport probe. Never sends a packet or asks for a signature. */
export const probe_agent_connection = (
  input: ProbeInput
): Promise<
  Readonly<{
    challenge_received: true
    authenticated: false
    packets_sent: 0
  }>
> => {
  const endpoint = probe_url(input)
  return new Promise((resolve, reject) => {
    // Bun 1.1 supports header options on its global WebSocket; DOM typings omit that overload.
    const socket_type = WebSocket as unknown as BunSocketConstructor
    const socket = new socket_type(endpoint, { headers: { Origin: input.origin } })
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve({ challenge_received: true, authenticated: false, packets_sent: 0 })
    }
    const timer = setTimeout(
      () => finish(new Error('No authentication challenge within five seconds.')),
      PROBE_TIMEOUT_MS
    )
    socket.addEventListener('error', () => finish(new Error('WebSocket connection failed.')))
    socket.addEventListener('close', () => finish(new Error('Connection closed before its challenge.')))
    socket.addEventListener('message', (event) => {
      try {
        if (typeof event.data !== 'string') throw new Error('Expected a text protocol packet.')
        const packet = parse_server_packet(event.data)
        if (
          packet.type !== 'packet/signature_request' ||
          typeof packet.payload !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packet.payload)
        )
          throw new Error('Expected an AresRPG authentication challenge.')
        finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Invalid challenge.'))
      }
    })
  })
}

const run_probe_cli = async (args: readonly string[]) => {
  const [endpoint, origin, address, ...extra] = args.slice(2)
  if (!endpoint || !origin || !address || extra.length) {
    console.error('Usage: bun packages/sdk/examples/agent_probe.ts <ws-url> <allowed-origin> <public-address>')
    process.exitCode = 1
  } else {
    try {
      console.log(JSON.stringify(await probe_agent_connection({ endpoint, origin, address })))
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Probe failed.')
      process.exitCode = 1
    }
  }
}

if (import.meta.main) await run_probe_cli(process.argv)
