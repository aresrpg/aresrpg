// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentTransport } from '@aresrpg/sdk/agent-connection'

import { create_actor_runtime } from '../../src/actor_runtime.ts'
import { request_provisioning, run_provisioning } from '../../src/provisioning.ts'
import { create_envelope_cipher } from '../../src/envelope_cipher.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../../src/control.ts'
import type { ControlStore } from '../../src/store.ts'
import type { Grant } from '../../src/model.ts'

import { fixture_config, fixture_google, memory_store, put } from './control_fixture.ts'
import { managed_provider_fixture } from './managed_provider_fixture.ts'

export const runtime_fixture = async (store: ControlStore = memory_store()) => {
  const provider = managed_provider_fixture()
  await request_provisioning(store, {
    id: 'bot',
    owner: fixture_google.toSuiAddress(),
    zklogin_public_identifier: fixture_google.toBase64(),
    policy: { revision: 1, scopes: fixture_config.scopes },
  })
  const bot = await run_provisioning(store, provider, 'bot')
  const grant: Grant = {
    id: 'grant',
    authority_generation: fixture_config.authority_generation,
    owner: bot.owner,
    client_id: 'client',
    bot_id: bot.id,
    network: 'mainnet',
    address: bot.address,
    descriptor: bot.multisig_public_key,
    generation: 1,
    resource: fixture_config.resource,
    scopes: fixture_config.scopes,
    policy_revision: 1,

    revoked: false,
    code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
    family: null,
    access: null,
  }
  await put(store, 'grant:grant', grant)
  const clock = { now: 1000, monotonic: 100 }
  const sockets: { handlers: Parameters<AgentTransport['open']>[1]; closed: boolean; sent: string[] }[] = []
  const errors: unknown[] = []
  const options = {
    store,
    config: fixture_config,
    provider,
    cipher: create_envelope_cipher(new Uint8Array(32).fill(7), 'fixture'),
    endpoint: 'ws://127.0.0.1:0/',
    origin: fixture_config.web_origin,
    actor_id: 'actor',
    lease_ms: 10000,
    event_limit: 20,
    scan_limit: 100,
    observation_freshness_ms: 60000,
    sdk_options: { rpc_url: 'http://127.0.0.1:0/' },
    now: () => clock.now,
    monotonic_now: () => clock.monotonic,
    report_failure: (error: unknown) => {
      // eslint-disable-next-line fp-law/no-mutating-methods -- Test-owned recording array is the injected observer output.
      errors.push(error)
    },
    transport: {
      open: (_url: string, handlers: Parameters<AgentTransport['open']>[1]) => {
        const socket = { handlers, closed: false, sent: [] as string[] }
        // eslint-disable-next-line fp-law/no-mutating-methods -- Test-owned transport sessions retain observable fixture handles.
        sockets.push(socket)
        return {
          send: (raw: string) => {
            socket.sent[socket.sent.length] = raw
          },
          close: () => {
            socket.closed = true
          },
        }
      },
    },
  }
  const runtime = create_actor_runtime(options)
  const observe = (payload: Readonly<Record<string, unknown>> = {}) => runtime.observe(grant, payload)
  const send = async (packet: unknown) => sockets.at(-1)!.handlers.on_message(JSON.stringify(packet))
  const admit = async () => {
    await send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
    await send({ type: 'packet/game_state', frozen: false })
    await send({ type: 'packet/connection_accepted', address: bot.address })
    await send({
      type: 'packet/server_info',
      online: 1,
      online_characters: 0,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: 1000,
      chain_sample_age_ms: 0,
    })
    await send({ type: 'packet/characters', characters: [] })
  }
  return { store, bot, grant, clock, options, runtime, observe, send, admit, sockets, errors }
}
