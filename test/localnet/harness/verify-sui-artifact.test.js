// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const verifier = new URL('./verify-sui-artifact.sh', import.meta.url).pathname
const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8')
const x86_64_row = dockerfile.match(/^ARG SUI_ROW_X86_64=(.+)$/m)?.[1] ?? ''

const verify = (...args) => Bun.spawnSync(['sh', verifier, ...args])
const stderr = (result) => result.stderr.toString()

describe('Sui release artifact verifier', () => {
  test('an aarch64 fetch paired with the x86_64 digest fails loudly before the artifact is touched', () => {
    const result = verify('aarch64', x86_64_row, '/must/not/be/read')

    expect(result.exitCode).not.toBe(0)
    expect(stderr(result)).toContain(
      '[sui-artifact] architecture mismatch: resolved aarch64 but selected digest row x86_64'
    )
    expect(stderr(result)).toContain('refusing before fetch, extraction, or binary execution')
    expect(stderr(result)).not.toContain('/must/not/be/read')
  })

  test('a matching architecture row verifies its artifact bytes', () => {
    const digest = createHash('sha256').update(readFileSync(verifier)).digest('hex')
    const result = verify('aarch64', `aarch64:${digest}`, verifier)

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(`${verifier}: OK`)
  })

  test('the fetch path binds the resolved arch to its row before fetch and checksum before extraction', () => {
    const prefetch_assert = dockerfile.indexOf('verify-sui-artifact.sh "${SUI_ARCH}" "${SUI_ROW}" \\')
    const fetch = dockerfile.indexOf('curl -fsSL -o /tmp/sui.tgz')
    const byte_verify = dockerfile.indexOf('verify-sui-artifact.sh "${SUI_ARCH}" "${SUI_ROW}" /tmp/sui.tgz')
    const extract = dockerfile.indexOf('tar -xzf /tmp/sui.tgz')

    expect(prefetch_assert).toBeGreaterThan(-1)
    expect(fetch).toBeGreaterThan(prefetch_assert)
    expect(byte_verify).toBeGreaterThan(fetch)
    expect(extract).toBeGreaterThan(byte_verify)
  })
})
