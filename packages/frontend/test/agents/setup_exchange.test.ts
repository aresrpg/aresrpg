// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { parse_client_packet, type AgentSetupRequest } from '@aresrpg/protocol'

import { run_agent_setup } from '../../src/agents/setup_exchange.ts'
import type { AuthSession } from '../../src/auth.ts'
import type { PairingInput } from '../../src/agents/pairing_state.ts'
import type { SetupExchange } from '../../src/agents/setup_requests.ts'

const wallet = { address: 'owner' } as AuthSession
const identity = { address: 'agent', multisig_public_key: 'public', signer_mode: 'host-persistent' as const }
test('one browser-generated capability binds begin, setup link, status and cleanup', async () => {
  const requests: AgentSetupRequest[] = []
  const reports: PairingInput[] = []
  const pairing_id = crypto.randomUUID()
  const exchange: SetupExchange = async (_wallet, request) => {
    expect(() =>
      parse_client_packet(JSON.stringify({ type: 'packet/agent_setup_request', id: 1, request }))
    ).not.toThrow()
    requests.push(request)
    switch (request.action) {
      case 'begin':
        return { action: 'begin', pairing_id, token: request.token }
      case 'status':
        return { action: 'status', identity }
      case 'cancel':
        return { action: 'cancel' }
    }
  }
  expect(
    await run_agent_setup(wallet, 'public', 1, exchange, new AbortController().signal, (report) => reports.push(report))
  ).toBe(identity)
  expect(requests.map((request) => request.action)).toEqual(['begin', 'status', 'cancel'])
  expect(new Set(requests.map((request) => request.token)).size).toBe(1)
  const { token } = requests[0]!
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(reports[0]).toEqual({
    type: 'link',
    attempt: 1,
    link: expect.stringContaining(`?id=${pairing_id}#${token}`),
  })
})

test('an aborted late begin only cancels the capability that it created', async () => {
  const controller = new AbortController()
  const release = Promise.withResolvers<void>()
  const requests: AgentSetupRequest[] = []
  const reports: PairingInput[] = []
  const pairing_id = crypto.randomUUID()
  const exchange: SetupExchange = async (_wallet, request) => {
    requests.push(request)
    if (request.action === 'begin') {
      await release.promise
      return { action: 'begin', pairing_id, token: request.token }
    }
    return { action: 'cancel' }
  }
  const pending = run_agent_setup(wallet, 'public', 1, exchange, controller.signal, (report) => reports.push(report))
  const rejected = pending.then(
    () => false,
    () => true
  )
  controller.abort()
  release.resolve()
  expect(await rejected).toBe(true)
  expect(reports).toEqual([])
  expect(requests[1]).toEqual({ action: 'cancel', pairing_id, token: requests[0]!.token })
})
