// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_fight } from '@aresrpg/fight'
import type {
  HostedChallengeResponse,
  HostedBotDescriptor,
  HostedAuthorizeResponse,
  FightStateRow,
} from '@aresrpg/protocol'
import type { AgentPairingResponse } from '@aresrpg/sdk/agent-pairing'
import { verify_agent_pairing } from '@aresrpg/sdk/agent-pairing'
import type { SuiTransport } from '@aresrpg/sdk'

import { create_fixture } from '../../fight/test/helpers.ts'
import { fake_client, pins, id } from '../../sdk/test/helpers/transport.ts'
import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_redis_store, type ControlStore } from '../src/store.ts'
import { hash_secret, random_secret } from '../src/security.ts'
import { gameplay_json, fight_checkpoint_id } from '../src/gameplay.ts'
import type { Command, Lane } from '../src/control.ts'

import { fixture_redis } from './helpers/redis_fixture.ts'
import { signed_fixture } from './helpers/signed_runtime_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { create_http_fixture } from './helpers/http_fixture.ts'
import { memory_store } from './helpers/control_fixture.ts'

const fight_fixture = (address: string) => {
  const initial = create_fixture().checkpoint
  const first = initial.contract.fighters[0]!
  if (first.kind.type !== 'player') throw new Error('fixture needs player')
  const character_id = id(101)
  const fight = id(102)
  const state = {
    ...initial,
    contract: {
      ...initial.contract,
      id: fight,
      fighters: [
        { ...first, kind: { ...first.kind, owner: address, character: character_id } },
        ...initial.contract.fighters.slice(1),
      ],
    },
    sources: { ...initial.sources, players: { [character_id]: initial.sources.players['0xc1']! } },
  }
  const local = create_fight({ state, mode: 'local', seed: 91n })
  const started = local.apply({ type: 'start', observed_ms: 60000n })
  if (started.error) throw new Error(started.error.code)
  const row = JSON.parse(
    gameplay_json({ contract: started.state.contract, players: started.state.sources.players, kolizeum: null })
  ) as FightStateRow
  const seat = Number(started.state.contract.queue[Number(started.state.contract.turn_ptr)])
  return { character_id, fight, row, seat }
}
const run_vertical = async (store: ControlStore, actor_store: ControlStore = store) => {
  const base = await runtime_fixture()
  await base.runtime.stop()
  const chain = fake_client({ simulate_ok: true })
  const execute = chain.core.executeTransaction
  const receipts = new Map<string, Awaited<ReturnType<typeof execute>>>()
  const client = {
    ...chain,
    core: {
      ...chain.core,
      executeTransaction: async (input: { transaction: Uint8Array }) => {
        const receipt = await execute(input)
        const complete = {
          ...receipt,
          Transaction: {
            ...receipt.Transaction!,
            effects: {
              ...receipt.Transaction!.effects!,
              gasUsed: { computationCost: '100', storageCost: '20', storageRebate: '5' },
            },
          },
        }
        receipts.set(complete.Transaction.digest!, complete)
        return complete
      },
      waitForTransaction: async ({ digest }: { digest: string }) => {
        const receipt = receipts.get(digest)
        if (!receipt) throw new Error('fixture transaction not found')
        return receipt
      },
    },
  } as unknown as SuiTransport
  const runtime = create_actor_runtime({
    ...base.options,
    store: actor_store,
    now: Date.now,
    monotonic_now: () => performance.now(),
    sdk_options: {
      client,
      pins: { ...pins, content_root: { id: id(110), shared_version: '1' }, seed_package_original: id(111) },
    },
  })
  const http = create_http_fixture(store, undefined, runtime.observe)
  try {
    const connector = await http.json<{ client_id: string }>('/oauth/register', {
      client_name: 'Fixture external AI',
      redirect_uris: ['https://client.example.test/callback'],
      token_endpoint_auth_method: 'none',
    })
    const verifier = random_secret()
    const redirect = await http.request(
      `/authorize?${new URLSearchParams({
        client_id: connector.client_id,
        redirect_uri: 'https://client.example.test/callback',
        response_type: 'code',
        scope: http.config.scopes.join(' '),
        resource: http.config.resource,
        state: 'fixture-csrf',
        code_challenge_method: 'S256',
        code_challenge: hash_secret(verifier),
      })}`
    )
    const authorization_id = new URL(redirect.headers.get('location')!).searchParams.get('authorization_id')!
    const identity = {
      authorization_id,
      owner: base.bot.owner,
      zklogin_public_identifier: base.bot.zklogin_public_identifier,
    }
    const challenge = await http.json<HostedChallengeResponse>('/connect/challenge', {
      ...identity,
      purpose: 'session',
    })
    await http.json('/connect/verify', {
      challenge_id: challenge.challenge_id,
      signature: http.signature(challenge.message),
    })
    expect((await http.request('/connect/bots', { authorization_id })).status).toBe(202)
    await runtime.tick()
    await runtime.settle()
    const created = await http.json<{ status: string; bot: HostedBotDescriptor }>('/connect/bots', { authorization_id })
    expect(created.status).toBe('ready')
    const request = {
      version: 1 as const,
      nonce: crypto.randomUUID(),
      network: 'mainnet' as const,
      owner: identity.owner,
      zklogin_public_identifier: identity.zklogin_public_identifier,
    }
    const proof_input = { authorization_id, bot_id: created.bot.id, request }
    expect((await http.request('/connect/proof', proof_input)).status).toBe(202)
    await runtime.tick()
    await runtime.settle()
    const proof = await http.json<{ status: string; proof: AgentPairingResponse }>('/connect/proof', proof_input)
    expect((await verify_agent_pairing(request, proof.proof)).address).toBe(created.bot.address)
    const consent = await http.json<HostedChallengeResponse>('/connect/challenge', {
      ...identity,
      purpose: 'consent',
      bot_id: created.bot.id,
      generation: created.bot.generation,
      address: created.bot.address,
      multisig_public_key: created.bot.multisig_public_key,
      policy_revision: created.bot.policy_revision,
    })
    const approval = await http.json<HostedAuthorizeResponse>('/connect/authorize', {
      challenge_id: consent.challenge_id,
      signature: http.signature(consent.message),
    })
    const tokens = await http.json<{ access_token: string }>('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: connector.client_id,
      code: new URL(approval.redirect_url).searchParams.get('code'),
      redirect_uri: 'https://client.example.test/callback',
      code_verifier: verifier,
      resource: http.config.resource,
    })
    const call = async <T>(name: string, args: object): Promise<T> => {
      const response = await http.json<{ result: { isError: boolean; structuredContent: T } }>(
        '/mcp',
        {
          jsonrpc: '2.0',
          id: random_secret(),
          method: 'tools/call',
          params: { name, arguments: args },
        },
        tokens.access_token
      )
      if (response.result.isError) throw new Error(JSON.stringify(response.result.structuredContent))
      return response.result.structuredContent
    }
    expect(await call('bot_observe', {})).toEqual({ status: 'pending' })
    await runtime.tick()
    await runtime.settle()
    const fight = fight_fixture(created.bot.address)
    await base.send({ type: 'packet/signature_request', payload: '11111111-1111-4111-8111-111111111111' })
    await base.send({ type: 'packet/game_state', frozen: false })
    await base.send({ type: 'packet/connection_accepted', address: created.bot.address })
    await base.send({
      type: 'packet/server_info',
      online: 1,
      online_characters: 1,
      indexing_lag: 0,
      current_epoch: '1',
      chain_timestamp_ms: 63000,
      chain_sample_age_ms: 0,
    })
    await base.send({
      type: 'packet/characters',
      characters: [
        {
          jobs: {},
          equipment: [],
          id: fight.character_id,
          custody: 'fight',
          active_fight: { id: fight.fight, seat: fight.seat },
        },
      ],
    })
    await base.send({
      type: 'packet/fight_state',
      fight: fight.fight,
      state: fight.row,
      seats: { [fight.character_id]: fight.seat },
    })
    await runtime.tick()
    await runtime.settle()
    const observed = await call<{ observation_revision: number; decision_revision: number; state: string }>(
      'bot_observe',
      {}
    )
    expect(observed.state).toBe('awaiting_ai')
    const turn = {
      character_id: fight.character_id,
      fight: fight.fight,
      fighter_idx: String(fight.seat),
      checkpoint_id: fight_checkpoint_id(fight.row),
      actions: [],
    }
    const accepted = await call<{ command_id: string }>('bot_fight_turn', {
      idempotency_key: 'one-turn',
      observation_revision: observed.observation_revision,
      decision_revision: observed.decision_revision,
      action: turn,
    })
    await runtime.tick()
    await runtime.settle()
    const settled = await call<Command>('bot_status', { command_id: accepted.command_id })
    expect(settled.status).toBe('completed')
    expect(settled.result).toMatchObject({ success: true, gas_mist: '115' })
    expect(chain.calls.executions).toBe(1)
    expect(base.sockets).toHaveLength(1)
    const commands = await store.scan_keys('command:', 100)
    await call('bot_observe', {})
    await http.json('/oauth/revoke', { client_id: connector.client_id, token: tokens.access_token })
    await runtime.tick()
    await runtime.settle()
    expect(await store.scan_keys('command:', 100)).toEqual(commands)
    expect(
      (
        await http.request(
          '/mcp',
          { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bot_observe', arguments: {} } },
          tokens.access_token
        )
      ).status
    ).toBe(401)
    expect(chain.calls.executions).toBe(1)
  } finally {
    await runtime.stop()
  }
}

test('fixture HTTP owner flow reaches the backend actor and actual SDK executor once', async () =>
  run_vertical(memory_store()))
const redis_url = process.env.TEST_BOT_REDIS_URL
const redis_test = redis_url ? test : test.skip
redis_test('Redis vertical owner/provision/proof/OAuth/MCP/actor/SDK/receipt path', async () => {
  const redis = fixture_redis(redis_url!)
  await redis.connect()
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  const recovery_namespace = `${namespace}:recovery`
  try {
    const service_store = create_redis_store(redis, namespace)
    await run_vertical(service_store, service_store)
    const recovery_store = create_redis_store(redis, recovery_namespace)
    const recovery = await signed_fixture(recovery_store)
    try {
      await recovery.runtime.tick()
      await recovery.runtime.settle()
      expect(recovery.submissions).toHaveLength(0)
      await recovery.admit()
      await recovery.runtime.tick()
      await recovery.runtime.settle()
      expect(recovery.errors).toEqual([])
      expect(recovery.submissions).toEqual([recovery.bytes])
      expect((await recovery_store.read<Command>('command:signed'))!.status).toBe('completed')
      expect((await recovery_store.read<Lane>(recovery.lane_key))!.pending).toBeNull()
    } finally {
      await recovery.runtime.stop()
    }
  } finally {
    await redis.send('DEL', [namespace, recovery_namespace])
    redis.close()
  }
})
