// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Coverage for THE ASSERT-ENV GATE + SWITCH-BACK LAW (env_guard.mjs). Pure/injected for the primitives;
// one subprocess proves a WIRED script (ceremony_upgrade) refuses under a mocked MAINNET active-env.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { assert_env, with_env, read_active_env } from './env_guard.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))

const fixture_config = (active_env) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-'))
  fs.writeFileSync(
    path.join(dir, 'client.yaml'),
    `active_env: ${active_env}\nactive_address: "0xabc"\n`
  )
  return dir
}

describe('read_active_env — honors SUI_CONFIG_DIR (mirrors getSigner)', () => {
  test('reads active_env from client.yaml under SUI_CONFIG_DIR', () => {
    const dir = fixture_config('mainnet')
    const prev = process.env.SUI_CONFIG_DIR
    process.env.SUI_CONFIG_DIR = dir
    try {
      expect(read_active_env()).toBe('mainnet')
    } finally {
      if (prev === undefined) delete process.env.SUI_CONFIG_DIR
      else process.env.SUI_CONFIG_DIR = prev
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('assert_env — REFUSE on mismatch, print the OPEN instruction', () => {
  test('mismatch throws the switch instruction (and never switches)', () => {
    expect(() => assert_env('testnet', { read: () => 'mainnet' })).toThrow(
      /active-env is "mainnet".*requires "testnet".*switch --env testnet.*NETWORK=testnet/s
    )
  })
  test('match returns the active env, no throw', () => {
    expect(assert_env('testnet', { read: () => 'testnet' })).toBe('testnet')
  })
})

describe('with_env — THE SWITCH-BACK LAW (restore on BOTH exit paths)', () => {
  test('restores the found env on SUCCESS', async () => {
    const calls = []
    const r = await with_env('testnet', async () => 'ok', {
      read: () => 'mainnet',
      switch_to: (n) => calls.push(n),
    })
    expect(r).toBe('ok')
    expect(calls).toEqual(['testnet', 'mainnet']) // switched out, then RESTORED
  })
  test('restores the found env on THROWN failure', async () => {
    const calls = []
    await expect(
      with_env(
        'testnet',
        async () => {
          throw new Error('boom')
        },
        { read: () => 'mainnet', switch_to: (n) => calls.push(n) }
      )
    ).rejects.toThrow('boom')
    expect(calls).toEqual(['testnet', 'mainnet']) // restored despite the throw
  })
  test('no switch when already on the expected env', async () => {
    const calls = []
    await with_env('testnet', async () => 'ok', {
      read: () => 'testnet',
      switch_to: (n) => calls.push(n),
    })
    expect(calls).toEqual([])
  })
})

describe('WIRED: ceremony_upgrade refuses under a mocked MAINNET active-env', () => {
  test('entry assert_env aborts non-zero before any chain op', () => {
    const dir = fixture_config('mainnet')
    const key = new Ed25519Keypair().getSecretKey() // throwaway suiprivkey → client.js skips the keystore
    let err
    try {
      execFileSync('bun', ['ceremony_upgrade.mjs'], {
        cwd: __dir,
        env: {
          ...process.env,
          SUI_CONFIG_DIR: dir,
          NETWORK: 'testnet',
          PRIVATE_KEY: key,
          UPGRADE_CAP: '0x1',
          PKG_PATH: __dir,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (e) {
      err = e
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    expect(err).toBeDefined()
    expect(err.status).not.toBe(0)
    expect(`${err.stdout || ''}${err.stderr || ''}`).toMatch(
      /ENV GUARD REFUSED.*requires "testnet"/s
    )
  })
})
