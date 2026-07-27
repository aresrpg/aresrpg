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

import {
  assert_env,
  with_env,
  read_active_env,
  assert_trunk_ancestry,
  assert_publishable_tree,
  clean_tree_verdict,
  path_inside_repo_verdict,
} from './env_guard.mjs'

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

describe('trunk ancestry (#1298) — the wrong-TREE door', () => {
  const io = (head, edge, is_ancestor) => ({
    read_head: () => head,
    read_edge: () => edge,
    is_ancestor: () => is_ancestor,
  })
  const sha = (h) => h.repeat(40).slice(0, 40)

  test('a HEAD edge already carries passes — ancestor, not equality', () => {
    expect(assert_trunk_ancestry(io(sha('a'), sha('b'), true)).ok).toBe(true)
    expect(assert_trunk_ancestry(io(sha('a'), sha('a'), false)).ok).toBe(true)
  })

  test('a HEAD trunk never absorbed is REFUSED — the #1298 ceremony', () => {
    expect(() => assert_trunk_ancestry(io(sha('a'), sha('b'), false))).toThrow(
      /TRUNK ANCESTRY REFUSED/
    )
  })

  test('an unreadable HEAD or edge refuses too — never a silent pass', () => {
    expect(() => assert_trunk_ancestry(io('', sha('b'), true))).toThrow(
      /could not read HEAD/
    )
    expect(() => assert_trunk_ancestry(io(sha('a'), '', true))).toThrow(
      /could not read/
    )
  })
})

describe('tree integrity (#1305) — the wrong-BYTES door', () => {
  const clean = () => ''
  const dirty = () =>
    ' M packages/move/aresrpg/sources/world.move\n?? packages/move/aresrpg/sources/injected.move'

  test('a clean Move tree with in-repo paths passes', () => {
    expect(() =>
      assert_publishable_tree({
        ancestry: () => {},
        read_status: clean,
        root: '/repo',
        resolve_path: () => '/repo/packages/move/aresrpg',
        paths: ['packages/move/aresrpg'],
      })
    ).not.toThrow()
  })

  test('uncommitted or untracked Move files are REFUSED — ancestry alone never saw them', () => {
    expect(() =>
      assert_publishable_tree({
        ancestry: () => {},
        read_status: dirty,
        paths: [],
      })
    ).toThrow(/PUBLISH TREE REFUSED/)
  })

  test('a package path outside the verified repository is REFUSED', () => {
    expect(() =>
      assert_publishable_tree({
        ancestry: () => {},
        read_status: clean,
        root: '/repo',
        resolve_path: () => '/somewhere/else/aresrpg',
        paths: ['/somewhere/else/aresrpg'],
      })
    ).toThrow(/PUBLISH PATH REFUSED/)
  })

  test('ancestry still runs FIRST — a clean tree on the wrong commit is no defence', () => {
    expect(() =>
      assert_publishable_tree({
        ancestry: () => {
          throw new Error('TRUNK ANCESTRY REFUSED (#1298): synthetic')
        },
        read_status: clean,
        paths: [],
      })
    ).toThrow(/TRUNK ANCESTRY REFUSED/)
  })

  test('clean_tree_verdict ignores blank lines, counts real ones', () => {
    expect(clean_tree_verdict(['', '   ', '']).ok).toBe(true)
    expect(clean_tree_verdict([' M a.move', '?? b.move']).reason).toContain(
      '2 uncommitted'
    )
  })

  test('path_inside_repo_verdict accepts packages/move and its children only', () => {
    const root = '/repo'
    expect(path_inside_repo_verdict('/repo/packages/move', root).ok).toBe(true)
    expect(
      path_inside_repo_verdict('/repo/packages/move/aresrpg', root).ok
    ).toBe(true)
    expect(path_inside_repo_verdict('/repo/packages/moveX', root).ok).toBe(
      false
    )
    expect(path_inside_repo_verdict('/repo/packages', root).ok).toBe(false)
    expect(path_inside_repo_verdict('/elsewhere', root).ok).toBe(false)
  })
})
