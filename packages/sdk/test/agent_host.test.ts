// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { verify_agent_pairing } from '../src/agent_pairing.ts'
import { agent_status, initialize_agent, load_agent_signer, pair_agent } from '../examples/agent_host.ts'

// Known synthetic fixture, never a user's credential or funded identity. No real key is generated.
const fixture = () => Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const request = {
  version: 1 as const,
  nonce: '11111111-1111-4111-8111-111111111111',
  network: 'mainnet' as const,
  owner: google.toSuiAddress(),
  zklogin_public_identifier: google.toBase64(),
}
const link = `http://localhost:9800/api/agent-setup?id=${request.nonce}#${'a'.repeat(43)}`
const in_directory = async (action: (directory: string) => Promise<void>) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ares-agent-fixture-')))
  try {
    await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
const exchange = (inspect: (method: string) => Promise<void> = async () => {}) =>
  (async (_url, init) => {
    await inspect(init?.method ?? 'GET')
    expect(new URL(String(_url)).hash).toBe('')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${'a'.repeat(43)}`)
    expect(init?.redirect).toBe('error')
    return Response.json(
      init?.method === 'POST' ? await verify_agent_pairing(request, JSON.parse(String(init.body))) : request
    )
  }) as typeof fetch

test('initialization requires approval, protects files and never replaces the existing key', () =>
  in_directory(async (directory) => {
    await expect(initialize_agent(directory, false, fixture)).rejects.toThrow('KEY_CREATION_APPROVAL_REQUIRED')
    expect(await agent_status(directory).catch(() => null)).toBeNull()
    const first = await initialize_agent(directory, true, fixture)
    const second = await initialize_agent(directory, true, () => {
      throw new Error('MUST_NOT_GENERATE')
    })
    expect(second).toEqual(first)
    expect((await stat(join(directory, 'key.json'))).mode & 0o777).toBe(0o600)
    expect(await agent_status(directory)).toEqual({ status: 'initialized', ...first })
  }))

test('pairing persists public identity before POST and reloads without a token or network', () =>
  in_directory(async (directory) => {
    await initialize_agent(directory, true, fixture)
    const signer = await pair_agent(directory, link, {
      fetch: exchange(async (method) => {
        if (method === 'POST')
          expect(JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8')).phase).toBe('pending')
      }),
    })
    const loaded = await load_agent_signer(directory)
    expect(loaded.address).toBe(signer.address)
    const message = new TextEncoder().encode('restart verification')
    expect(
      await loaded.public_key.verifyPersonalMessage(message, (await loaded.sign_personal_message(message)).signature)
    ).toBe(true)
    const public_record = await readFile(join(directory, 'identity.json'), 'utf8')
    expect(public_record).not.toContain(fixture().getSecretKey())
    expect(public_record).not.toContain('a'.repeat(43))
    expect(public_record).not.toContain('signature')
    expect((await agent_status(directory)).status).toBe('paired')
    let fetched = false
    await expect(
      pair_agent(directory, link, {
        fetch: (async () => {
          fetched = true
        }) as unknown as typeof fetch,
      })
    ).rejects.toThrow('ALREADY_PAIRED_USE_STATUS')
    expect(fetched).toBe(false)
  }))

test('missing key fails before network; paired identity prevents silent replacement', () =>
  in_directory(async (directory) => {
    let fetched = false
    await expect(
      pair_agent(directory, link, {
        fetch: (async () => {
          fetched = true
        }) as unknown as typeof fetch,
      })
    ).rejects.toThrow('AGENT_KEY_MISSING')
    expect(fetched).toBe(false)
    await initialize_agent(directory, true, fixture)
    await pair_agent(directory, link, { fetch: exchange() })
    await rm(join(directory, 'key.json'))
    await expect(initialize_agent(directory, true, fixture)).rejects.toThrow('AGENT_KEY_MISSING')
  }))

test('uncertain completion remains pending and cannot load as paired; fresh link reuses identity', () =>
  in_directory(async (directory) => {
    await initialize_agent(directory, true, fixture)
    await expect(
      pair_agent(directory, link, {
        fetch: exchange(async (method) => {
          if (method === 'POST') throw new Error('network failed')
        }),
      })
    ).rejects.toThrow('network failed')
    const status = await agent_status(directory)
    expect(status.status).toBe('pending')
    await expect(load_agent_signer(directory)).rejects.toThrow('PAIRING_OUTCOME_UNCONFIRMED')
    expect((await pair_agent(directory, link, { fetch: exchange() })).address).toBe(status.address!)
  }))

test('unsafe permissions, malformed keys and symlinks fail closed', () =>
  in_directory(async (directory) => {
    await initialize_agent(directory, true, fixture)
    const key = join(directory, 'key.json')
    await chmod(key, 0o644)
    await expect(agent_status(directory)).rejects.toThrow('PRIVATE_STORAGE_REQUIRED')
    await chmod(key, 0o600)
    await writeFile(key, 'secret parser preview must not escape')
    await expect(agent_status(directory)).rejects.toThrow('INVALID_STATE_FILE')
    await rm(key)
    await symlink('/nonexistent', key)
    await expect(agent_status(directory)).rejects.toThrow()
  }))

test('public identity tampering is rejected against the saved key', () =>
  in_directory(async (directory) => {
    await initialize_agent(directory, true, fixture)
    await pair_agent(directory, link, { fetch: exchange() })
    const path = join(directory, 'identity.json')
    const state = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...state, address: `0x${'0'.repeat(64)}` }))
    await expect(load_agent_signer(directory)).rejects.toThrow('AGENT_IDENTITY_MISMATCH')
  }))

test('a held operation lock refuses concurrent pairing before network', () =>
  in_directory(async (directory) => {
    await initialize_agent(directory, true, fixture)
    const lock = join(directory, 'operation.lock')
    await writeFile(lock, JSON.stringify({ pid: process.pid }), { mode: 0o600 })
    let fetched = false
    await expect(
      pair_agent(directory, link, {
        fetch: exchange(async () => {
          fetched = true
        }),
      })
    ).rejects.toThrow()
    expect(fetched).toBe(false)
    expect(await readFile(lock, 'utf8')).toContain(String(process.pid))
  }))

test('an unverified server result keeps the identity pending', () =>
  in_directory(async (directory) => {
    await initialize_agent(directory, true, fixture)
    await expect(
      pair_agent(directory, link, {
        fetch: (async (_url, init) =>
          Response.json(init?.method === 'POST' ? { address: 'foreign' } : request)) as typeof fetch,
      })
    ).rejects.toThrow('SETUP_IDENTITY_MISMATCH')
    expect((await agent_status(directory)).status).toBe('pending')
    await expect(load_agent_signer(directory)).rejects.toThrow('PAIRING_OUTCOME_UNCONFIRMED')
  }))
