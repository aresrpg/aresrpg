// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Redis } from 'ioredis'
import { MAX_ALLOCATION_WALLETS, blast_rows, normalize_address } from '@aresrpg/immutable/allocation'

import { serve_allocation } from '../../src/allocation/api.ts'
import { blast_allowlist } from '../../src/allocation/blast_allowlist.ts'
import { allocation_status } from '../../src/allocation/service.ts'
import { wallet_challenge, verify_wallet, verified_wallets, share_wallet } from '../../src/allocation/wallets.ts'
import { connect_redis, key } from '../../src/allocation/store.ts'

describe('campaign integration', () => {
  let directory: string
  let process_handle: ChildProcess
  let redis: Redis
  const owner = normalize_address('0x1')
  const other = normalize_address('0x2')
  const origin = 'https://aresrpg.world'
  const options = { origin }
  beforeAll(async () => {
    directory = await mkdtemp('/tmp/ares-allocation-')
    const socket = join(directory, 'redis.sock')
    process_handle = spawn(
      'redis-server',
      ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    await new Promise<void>((resolve, reject) => {
      process_handle.once('error', reject)
      process_handle.once('exit', (code) => reject(new Error(`Redis exited before readiness: ${code}`)))
      process_handle.stdout!.on('data', (chunk: Buffer) => {
        if (/ready to accept connections/i.test(chunk.toString())) resolve()
      })
    })
    redis = await connect_redis(socket)
  }, 10000)
  beforeEach(async () => {
    await redis.flushdb()
  })
  afterAll(async () => {
    redis?.disconnect()
    if (process_handle?.exitCode === null) {
      const ended = new Promise<void>((resolve) => process_handle.once('exit', () => resolve()))
      process_handle.kill('SIGTERM')
      await ended
    }
    if (directory) await rm(directory, { recursive: true, force: true })
  })
  const call = (action: string, cookie = '') =>
    serve_allocation(new Request(`${origin}/api/allocation?${action}`, { headers: { cookie } }), redis, options)
  const proof = async (signer: Ed25519Keypair, account = owner) => {
    const challenge = await wallet_challenge(redis, account, signer.toSuiAddress(), 'Wallet', origin)
    const { signature } = await signer.signPersonalMessage(new TextEncoder().encode(challenge.message))
    return { ...challenge, signature }
  }
  test('public lookup and old cookies cannot obtain cards or private identity', async () => {
    await redis.set(
      key('awards'),
      JSON.stringify([{ address: owner, tier: 'veteran', source: 'community', evidence: 'PRIVATE' }])
    )
    const response = await call(`action=status&address=${owner}`, 'allocation_session=old')
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('PRIVATE')
    const status = await allocation_status(redis, owner)
    expect(status.awards).toEqual([{ address: owner, tier: 'veteran', source: 'reserved' }])
    expect((await allocation_status(redis, other)).awards).toEqual([])
  })
  test("status carries Blast proofs only for the account's own awarded wallets", async () => {
    const awards = [
      { address: other, tier: 'member', source: 'social', evidence: '7' },
      { address: owner, tier: 'veteran', source: 'community', evidence: 'PRIVATE' },
    ]
    expect((await allocation_status(redis, owner)).proofs).toBeUndefined()
    await redis.set(key('awards'), JSON.stringify(awards))
    const { proofs } = await allocation_status(redis, owner)
    const expected = blast_allowlist(blast_rows(awards as never)).proof(owner)
    expect(proofs).toEqual([{ address: owner, proof: expected! }])
    expect(expected).toMatchObject({ index: '0', cap_mist: '125000000000' })
    expect(JSON.stringify(proofs)).not.toContain(other.slice(2))
  })
  test('cards are returned only after a real signature verifies and replay is refused', async () => {
    const signer = new Ed25519Keypair()
    await redis.set(
      key('awards'),
      JSON.stringify([{ address: signer.toSuiAddress(), tier: 'member', source: 'leaderboard', evidence: 'kills:4' }])
    )
    const challenge = await proof(signer)
    expect((await allocation_status(redis, owner)).awards).toEqual([])
    await verify_wallet(redis, owner, challenge.nonce, challenge.signature)
    expect((await allocation_status(redis, owner)).awards).toEqual([
      { address: signer.toSuiAddress(), tier: 'member', source: 'leaderboard', board: 'kills' },
    ])
    await expect(verify_wallet(redis, owner, challenge.nonce, challenge.signature)).rejects.toThrow('unauthorized')
  })
  test('a proof is bound to the Google account, wallet and fresh challenge', async () => {
    const signer = new Ed25519Keypair()
    const challenge = await proof(signer)
    await expect(verify_wallet(redis, other, challenge.nonce, challenge.signature)).rejects.toThrow('unauthorized')
    const fresh = await proof(signer)
    const foreign = await new Ed25519Keypair().signPersonalMessage(new TextEncoder().encode(fresh.message))
    await expect(verify_wallet(redis, owner, fresh.nonce, foreign.signature)).rejects.toThrow('unauthorized')
    expect(await verified_wallets(redis, owner)).toHaveLength(1)
  })
  test('ten-wallet ceiling is atomic, includes Google, and does not duplicate existing wallets', async () => {
    for (let index = 0; index < MAX_ALLOCATION_WALLETS - 2; index++) {
      const signer = new Ed25519Keypair()
      const value = await proof(signer)
      await verify_wallet(redis, owner, value.nonce, value.signature)
    }
    const a = await proof(new Ed25519Keypair())
    const b = await proof(new Ed25519Keypair())
    const results = await Promise.allSettled([
      verify_wallet(redis, owner, a.nonce, a.signature),
      verify_wallet(redis, owner, b.nonce, b.signature),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await verified_wallets(redis, owner)).toHaveLength(10)
    await expect(wallet_challenge(redis, owner, normalize_address('0xff'), 'wallet', origin)).rejects.toThrow(
      'wallet_limit'
    )
    const status = await allocation_status(redis, owner)
    expect(new Set(status.wallets.map(({ address }) => address)).size).toBe(10)
  })
  test('sharing needs verification and exposes only a public summary, including a wallet without a spot', async () => {
    await expect(share_wallet(redis, owner, other, origin)).rejects.toThrow('unauthorized')
    await verified_wallets(redis, owner)
    const url = await share_wallet(redis, owner, owner, origin)
    const response = await serve_allocation(new Request(url), redis, options)
    const html = await response.text()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(html).toContain('summary_large_image')
    expect(html).toContain('No spot')
    expect(html).not.toContain(owner)
    await redis.set(
      key('awards'),
      JSON.stringify([{ address: owner, tier: 'veteran', source: 'manual', evidence: 'PRIVATE' }])
    )
    const updated = await (await serve_allocation(new Request(url), redis, options)).text()
    expect(updated).toContain('833,333')
    expect(await share_wallet(redis, owner, owner, origin)).not.toBe(url)
    expect(updated).not.toContain('PRIVATE')
    const image_url = new URL(url)
    image_url.searchParams.set('action', 'image')
    const image = await serve_allocation(new Request(image_url), redis, options)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer()).slice(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    )
  })
})
