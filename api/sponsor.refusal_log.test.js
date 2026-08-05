// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2263 — EVERY REFUSAL LEAVES A LINE. The sponsor is the only process that knows WHY a player was turned
// away, and it kept that knowledge in a per-day counter only: a clock-skew outage (a device ≥5 minutes off
// fails `assert_zklogin_challenge_local`'s freshness window on every single transaction) was indistinguishable
// in the logs from a bad signature, a wrong issuer, or a player who never tried. This pins the structured line
// that makes the class diagnosable — reason, a TRUNCATED address, and the challenge's age in seconds, which is
// the measurement that names clock skew outright.
//
// Privacy is part of the contract, not a nicety: 8 characters of an address correlate two lines in a log and
// identify nobody, and the challenge contributes its AGE only — never its bytes, never a token, never a proof.
//
//   bun test api/sponsor.refusal_log.test.js     (no Redis, no fullnode, no station — the refusal is local)
//
// Own process on purpose (like every sibling suite): sponsor state reads REDIS_URL at module load.
//
// RED BEFORE THE FIX: zero `[sponsor] REFUSAL` lines — the refusal was counted and thrown, never described.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

// ── ENV POLARITY, STATED (sponsor_state.mjs memoizes at module load) ──
// No shared store configured ⇒ in-memory cap + reservation stash; `localnet` is the one network where a
// store-less process may still sponsor (sponsor.store_required.test.js owns that polarity). Every refusal
// driven here fires BEFORE any network call, so no fullnode or station is ever reached.
process.env.REDIS_URL = ''
process.env.VITE_NETWORK = 'localnet'
process.env.GAS_STATION_URL ||= 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH ||= 'test-bearer'
delete process.env.SPONSOR_DEV_BYPASS_ZKLOGIN
const S = await import('./sponsor.mjs')

const SENDER = '0x' + 'ab'.repeat(32)
const MARKER = '[sponsor] REFUSAL'

/** A kind-only PTB — well-formed, so the refusal under test is never a parse failure in disguise. */
const build_kind = async () => {
  const tx = new Transaction()
  tx.moveCall({ target: `0x${'2'.padStart(64, '0')}::zones::join_world`, arguments: [] })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}

let lines = []
const real_warn = console.warn
beforeEach(() => {
  lines = []
  console.warn = (...args) => {
    const line = args.map(String).join(' ')
    if (line.startsWith(MARKER)) lines.push(line)
  }
})
afterEach(() => {
  console.warn = real_warn
})

/** The one structured payload each line carries, parsed back out of it. */
const payloads = () => lines.map((line) => JSON.parse(line.slice(MARKER.length).trim()))

describe('#2263 a refused sponsorship emits exactly one structured line', () => {
  test('a stale challenge names its reason, a truncated address, and the challenge age', async () => {
    const age_seconds = 9 * 60 // well past the 5-minute window — the reported bug's shape
    const challenge = `aresrpg-sponsor:${SENDER}:${Date.now() - age_seconds * 1000}`

    await expect(
      S.reserveSponsored({ txKindBytes: await build_kind(), sender: SENDER, challenge, signature: 'not-a-zk-sig' })
    ).rejects.toThrow(/zklogin-stale/)

    expect(lines).toHaveLength(1)
    const [payload] = payloads()
    expect(payload.reason).toBe('zklogin')
    expect(payload.addr).toBe(SENDER.slice(0, 8))
    expect(payload.addr.length).toBe(8)
    expect(payload.challenge_age_s).toBeGreaterThanOrEqual(age_seconds)
    expect(payload.challenge_age_s).toBeLessThan(age_seconds + 5)
  })

  test('the line carries no secret — not the challenge bytes, not the signature, not the full address', async () => {
    const challenge = `aresrpg-sponsor:${SENDER}:${Date.now() - 600_000}`
    await expect(
      S.reserveSponsored({ txKindBytes: await build_kind(), sender: SENDER, challenge, signature: 'SECRET-SIG' })
    ).rejects.toThrow()

    const [line] = lines
    expect(line).not.toContain(SENDER)
    expect(line).not.toContain('SECRET-SIG')
    expect(line).not.toContain(challenge)
  })

  test('a refusal with no challenge to read still emits its line, with a null age', async () => {
    await expect(
      S.reserveSponsored({ txKindBytes: await build_kind(), sender: SENDER, challenge: '', signature: '' })
    ).rejects.toThrow(/zklogin-required/)

    expect(lines).toHaveLength(1)
    const [payload] = payloads()
    expect(payload.reason).toBe('zklogin')
    expect(payload.challenge_age_s).toBeNull()
  })
})
