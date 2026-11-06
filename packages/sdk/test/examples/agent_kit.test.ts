// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, rm, writeFile as write_file } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { create_agent_run, parse_agent_config } from '../../examples/agent_kit.ts'
import { assert_agent_endpoint, mainnet_agent_endpoint } from '../../examples/agent_deployment.ts'
import type { AgentTransport } from '../../src/agent_connection.ts'

const address = `0x${'1'.repeat(64)}`
const character = `0x${'2'.repeat(64)}`
const config = {
  version: 1,
  strategy: 'observe',
  objective: 'Watch selected character',
  endpoint: mainnet_agent_endpoint(),
  origin: 'http://localhost:5173',
  character_ids: [character],
  duration_ms: 1000,
  max_spend_mist: '0',
}
const signer = {
  address,
  sign_personal_message: async (message: Uint8Array) => ({
    bytes: Buffer.from(message).toString('base64'),
    signature: 'fixture-only',
  }),
}
const wire = () => {
  let handlers!: Parameters<AgentTransport['open']>[1]
  const sent: string[] = []
  let closed = 0
  let opened = 0
  const transport: AgentTransport = {
    open: (_url, callbacks) => {
      opened += 1
      handlers = callbacks
      return {
        send: (raw) => {
          sent.push(raw)
        },
        close: () => {
          closed += 1
        },
      }
    },
  }
  return {
    transport,
    sent,
    closed: () => closed,
    opened: () => opened,
    receive: async (packet: unknown) => handlers.on_message(JSON.stringify(packet)),
    close: () => handlers.on_close(1006, 'sensitive failure detail'),
  }
}
const admit = async (fixture: ReturnType<typeof wire>, ids = [character]) => {
  await fixture.receive({ type: 'packet/signature_request', payload: '00000000-0000-4000-8000-000000000000' })
  await fixture.receive({ type: 'packet/connection_accepted', address })
  await fixture.receive({ type: 'packet/characters', characters: ids.map((id) => ({ id, custody: 'kiosk' })) })
}

test('rejects invalid configuration before opening and freezes accepted config', () => {
  for (const change of [
    { secret: 'NEVER_PRINT' },
    { strategy: 'spend' },
    { max_spend_mist: '1' },
    { duration_ms: 0 },
    { duration_ms: 2_147_483_648 },
    { objective: '' },
    { character_ids: [character, character] },
    { endpoint: 'ws://example.com' },
    { origin: 'invalid' },
  ]) {
    const fixture = wire()
    expect(() => create_agent_run({ ...config, ...change }, { signer, transport: fixture.transport })).toThrow()
    expect(fixture.opened()).toBe(0)
  }
  const accepted = parse_agent_config(config)
  expect(Object.isFrozen(accepted)).toBe(true)
  expect(Object.isFrozen(accepted.character_ids)).toBe(true)
  expect(parse_agent_config({ ...config, character_ids: [] }).character_ids).toEqual([])
})

test('status observes lifecycle and selected roster; removal stops without replay or repeated output', async () => {
  const fixture = wire()
  const events: unknown[] = []
  const run = create_agent_run(config, {
    signer,
    transport: fixture.transport,
    emit: (event) => {
      events.push(event)
    },
  })
  expect(run.status().status).toBe('connecting')
  await admit(fixture)
  expect(run.status()).toMatchObject({ status: 'ready', reason: null, character_ids: [character] })
  const count = events.length
  await fixture.receive({ type: 'packet/pong', id: 1 })
  expect(events).toHaveLength(count)
  await fixture.receive({ type: 'packet/characters', characters: [] })
  expect(await run.done).toMatchObject({ status: 'stopped', reason: 'character_missing' })
  run.stop()
  expect(fixture.closed()).toBe(1)
  expect(fixture.sent).toHaveLength(1)
})

test('missing selected character after admission and transport failure terminate with safe reasons', async () => {
  const fixture = wire()
  const run = create_agent_run(config, { signer, transport: fixture.transport })
  expect(run.status().reason).toBeNull()
  await admit(fixture, [])
  expect((await run.done).reason).toBe('character_missing')
  const failed = wire()
  const other = create_agent_run(config, { signer, transport: failed.transport })
  failed.close()
  expect(await other.done).toEqual({
    type: 'status',
    status: 'stopped',
    reason: 'connection_failed',
    character_ids: [],
  })
})

test('duration stops hung signing and its late result cannot send a proof', async () => {
  const fixture = wire()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const run = create_agent_run(
    { ...config, duration_ms: 10 },
    {
      transport: fixture.transport,
      signer: {
        address,
        sign_personal_message: async (message) => {
          await pending
          return signer.sign_personal_message(message)
        },
      },
    }
  )
  const challenge = fixture.receive({
    type: 'packet/signature_request',
    payload: '00000000-0000-4000-8000-000000000000',
  })
  expect((await run.done).reason).toBe('duration_elapsed')
  release()
  await challenge
  expect(fixture.sent).toEqual([])
})

test('signer rejection exposes no raw exception in status', async () => {
  const fixture = wire()
  const run = create_agent_run(config, {
    transport: fixture.transport,
    signer: {
      address,
      sign_personal_message: async () => {
        throw new Error('PRIVATE_SENTINEL')
      },
    },
  })
  await fixture.receive({ type: 'packet/signature_request', payload: '00000000-0000-4000-8000-000000000000' })
  const result = await run.done
  expect(result.reason).toBe('connection_failed')
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL')
})

const cli = new URL('../../examples/agent_kit.ts', import.meta.url).pathname
const execute = async (args: string[]) => {
  const child = Bun.spawn([process.execPath, cli, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

test('CLI describe/check are offline and reject secret fields without echoing them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-agent-kit-'))
  try {
    const path = join(directory, 'config.json')
    const description = await execute(['describe'])
    expect(description.code).toBe(0)
    expect(JSON.parse(description.stdout).strategies).toEqual(['observe'])
    await write_file(path, JSON.stringify(config))
    expect((await execute(['check', path])).code).toBe(0)
    await write_file(path, JSON.stringify({ ...config, secret: 'PRIVATE_SENTINEL' }))
    const bad = await execute(['check', path])
    expect(bad.code).toBe(1)
    expect(bad.stdout + bad.stderr).not.toContain('PRIVATE_SENTINEL')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLI deadline bounds adapter initialization and stdin stop works before initialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-agent-kit-'))
  try {
    const path = join(directory, 'config.json')
    const adapter = join(directory, 'adapter.ts')
    await write_file(path, JSON.stringify({ ...config, duration_ms: 50 }))
    await write_file(adapter, 'await new Promise(() => {}); export const create_signer = () => {}')
    for (const stop of [false, true]) {
      const child = Bun.spawn([process.execPath, cli, 'run', path, adapter], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (stop) {
        child.stdin.write('status\nstop\n')
        await child.stdin.flush()
      }
      const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
      expect(code).toBe(0)
      expect(stdout).toContain(stop ? 'requested' : 'duration_elapsed')
      await child.stdin.end()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 5000)

test('CLI EOF and termination signals stop during adapter initialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-agent-kit-'))
  try {
    const path = join(directory, 'config.json')
    const adapter = join(directory, 'adapter.ts')
    await write_file(path, JSON.stringify(config))
    await write_file(adapter, 'await new Promise(() => {}); export const create_signer = () => {}')
    for (const control of ['eof', 'SIGINT', 'SIGTERM'] as const) {
      const child = Bun.spawn([process.execPath, cli, 'run', path, adapter], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      child.stdin.write('status\n')
      await child.stdin.flush()
      const reader = child.stdout.getReader()
      const initial = await reader.read()
      expect(new TextDecoder().decode(initial.value)).toContain('initializing')
      if (control === 'eof') await child.stdin.end()
      else child.kill(control)
      expect(await child.exited).toBe(0)
      const terminal = await reader.read()
      expect(new TextDecoder().decode(terminal.value)).toContain(control === 'eof' ? 'input_closed' : 'signal')
      reader.releaseLock()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 5000)

test('CLI invalid signer reports a stable initialization error without adapter details', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-agent-kit-'))
  try {
    const path = join(directory, 'config.json')
    const adapter = join(directory, 'adapter.ts')
    await write_file(path, JSON.stringify(config))
    for (const source of [
      "export const create_signer = () => { throw new Error('PRIVATE_SENTINEL') }",
      "export const create_signer = () => ({ address: 'PRIVATE_SENTINEL' })",
      'export const unrelated = true',
    ]) {
      await write_file(adapter, source)
      const child = Bun.spawn([process.execPath, cli, 'run', path, adapter], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code).toBe(1)
      expect(JSON.parse(stdout)).toEqual({ type: 'error', code: 'INITIALIZATION_FAILED' })
      expect(stdout + stderr).not.toContain('PRIVATE_SENTINEL')
      await child.stdin.end()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('deployment endpoint policy rejects arbitrary hosts and permits loopback only with injected transport', () => {
  expect(() => assert_agent_endpoint(mainnet_agent_endpoint())).not.toThrow()
  for (const endpoint of [
    'wss://testnet.aresrpg.world/',
    'wss://example.com/',
    'ws://127.0.0.1:9800/',
    `${mainnet_agent_endpoint()}?network=mainnet`,
    'wss://server.aresrpg.world.evil.invalid/',
  ])
    expect(() => assert_agent_endpoint(endpoint)).toThrow('MAINNET_ENDPOINT_REQUIRED')
  expect(() => assert_agent_endpoint('ws://127.0.0.1:9800/', true)).not.toThrow()
  expect(() => assert_agent_endpoint('wss://testnet.aresrpg.world/', true)).toThrow('MAINNET_ENDPOINT_REQUIRED')
})

test('CLI rejects a foreign endpoint before importing the signer adapter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-agent-endpoint-'))
  try {
    const path = join(directory, 'config.json')
    const adapter = join(directory, 'adapter.ts')
    await write_file(path, JSON.stringify({ ...config, endpoint: 'wss://testnet.aresrpg.world/' }))
    await write_file(adapter, 'console.log("ADAPTER_EXECUTED"); throw Error("should not load")')
    const result = await execute(['run', path, adapter])
    expect(result.code).toBe(1)
    expect(result.stdout + result.stderr).not.toContain('ADAPTER_EXECUTED')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
