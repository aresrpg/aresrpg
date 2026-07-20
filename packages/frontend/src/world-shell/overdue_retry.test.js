// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The overdue auto-crank retry discipline (crank ONCE on the distinct class only, never a blind retry,
// second failure surfaces). Zero mocks — injected effects. Pure-half rows live in @aresrpg/fight
// (packages/fight/src/turn_commit.test.js).
import { describe, it, expect } from 'bun:test'

import { commit_with_overdue_retry } from './overdue_retry.js'

describe('commit_with_overdue_retry — crank ONCE on the distinct class, never blind', () => {
  const overdue_error = Object.assign(new Error('sim refusal'), { overdue: true })
  const is_overdue = (/** @type {any} */ e) => e?.overdue === true

  it('happy path: one commit, zero cranks', async () => {
    let commits = 0
    let cranks = 0
    const out = await commit_with_overdue_retry({
      commit: async () => ++commits,
      crank: async () => ++cranks,
      is_overdue,
    })
    expect(out).toBe(1)
    expect(commits).toBe(1)
    expect(cranks).toBe(0)
  })

  it('overdue refusal: crank fires once, the retry lands', async () => {
    let commits = 0
    let cranks = 0
    const out = await commit_with_overdue_retry({
      commit: async () => {
        commits += 1
        if (commits === 1) throw overdue_error
        return 'landed'
      },
      crank: async () => ++cranks,
      is_overdue,
    })
    expect(out).toBe('landed')
    expect(commits).toBe(2)
    expect(cranks).toBe(1)
  })

  it('a NON-overdue failure rethrows untouched — zero cranks, zero retries (never a blind retry)', async () => {
    let commits = 0
    let cranks = 0
    const boom = new Error('EIllegalMove')
    await expect(
      commit_with_overdue_retry({
        commit: async () => {
          commits += 1
          throw boom
        },
        crank: async () => ++cranks,
        is_overdue,
      })
    ).rejects.toBe(boom)
    expect(commits).toBe(1)
    expect(cranks).toBe(0)
  })

  it('overdue twice: exactly ONE retry, the second failure surfaces (no crank loop)', async () => {
    let commits = 0
    let cranks = 0
    await expect(
      commit_with_overdue_retry({
        commit: async () => {
          commits += 1
          throw overdue_error
        },
        crank: async () => ++cranks,
        is_overdue,
      })
    ).rejects.toBe(overdue_error)
    expect(commits).toBe(2)
    expect(cranks).toBe(1)
  })

  it('a lost crank race is swallowed — the retry still runs and its verdict wins', async () => {
    let commits = 0
    const out = await commit_with_overdue_retry({
      commit: async () => {
        commits += 1
        if (commits === 1) throw overdue_error
        return 'landed after lost race'
      },
      crank: async () => {
        throw new Error('ENotYetExpired — a peer cranked first')
      },
      is_overdue,
    })
    expect(out).toBe('landed after lost race')
    expect(commits).toBe(2)
  })

  it('never cranks or retries an overdue-looking failure that already has a digest', async () => {
    const executed = Object.assign(new Error('ESomeoneOverdue'), { digest: '0xburned' })
    let commits = 0
    let cranks = 0
    await expect(
      commit_with_overdue_retry({
        commit: async () => {
          commits += 1
          throw executed
        },
        crank: async () => {
          cranks += 1
        },
        is_overdue: () => true,
      })
    ).rejects.toBe(executed)
    expect(commits).toBe(1)
    expect(cranks).toBe(0)
  })
})
