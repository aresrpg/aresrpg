// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  blast_csv,
  cap_mist,
  normalize_address,
  public_award,
  rank_social,
  select_awards,
  submitted_posts,
  sui_amount,
  tier_slots,
  validate_reserved,
  type Award,
  type Metrics,
  type Submission,
} from '@aresrpg/immutable/allocation'

const address = (value: number): string => normalize_address(`0x${value.toString(16)}`)
const submission = (value: number, posts = [String(value)]): Submission => ({
  user_id: String(value),
  username: `user${value}`,
  address: address(value),
  posts,
  submitted_at: '2026-10-23T12:00:00Z',
})
const metric = (value: number, likes: number, id = String(value)): Metrics => ({
  id,
  author_id: String(value),
  likes,
  reposts: 0,
  quotes: 0,
  observed_at: '2026-10-24T12:00:00Z',
})

describe('allocation conservation and ranking', () => {
  test('public awards expose only the public campaign fields', () => {
    const private_row = {
      address: address(1),
      tier: 'veteran' as const,
      source: 'manual' as const,
      evidence: 'private operator note',
      private_email: 'private@example.test',
    }
    expect(public_award(private_row)).toEqual({ address: address(1), tier: 'veteran', source: 'reserved' })
  })
  test('an empty board passes its own quota to X instead of increasing another board quota', () => {
    const boards = Array.from({ length: 9 }, (_, board) => ({
      metric: `board${board}`,
      addresses: board === 0 ? [] : Array.from({ length: 20 }, (_, rank) => address(1000 + board * 100 + rank)),
    }))
    const social = rank_social(
      Array.from({ length: 200 }, (_, index) => submission(index + 1)),
      Array.from({ length: 200 }, (_, index) => metric(index + 1, 200 - index))
    )
    const awards = select_awards([], boards, social)
    expect(awards.filter(({ tier, source }) => tier === 'veteran' && source === 'leaderboard')).toHaveLength(10)
    expect(awards.filter(({ tier, source }) => tier === 'member' && source === 'leaderboard')).toHaveLength(56)
    expect(awards.filter(({ tier, source }) => tier === 'veteran' && source === 'social')).toHaveLength(7)
    expect(awards.filter(({ tier, source }) => tier === 'member' && source === 'social')).toHaveLength(57)
  })
  test('rejects duplicate or overbooked reserved addresses', () => {
    const row: Award = { address: '0x1', tier: 'veteran', source: 'community', evidence: 'Chinese community' }
    expect(() => validate_reserved([row, { ...row, address: address(1) }])).toThrow('duplicate_address')
    expect(() =>
      validate_reserved(Array.from({ length: 4 }, (_, index) => ({ ...row, address: address(index + 1) })))
    ).toThrow('reserved_quota_exceeded')
  })
  test('rejects foreign, missing and duplicate posts instead of awarding fabricated zero scores', () => {
    expect(() => rank_social([submission(1)], [])).toThrow('missing_or_foreign_post')
    expect(() => rank_social([submission(1)], [metric(2, 500, '1')])).toThrow('missing_or_foreign_post')
    expect(() => submitted_posts(['https://x.com/a/status/1', 'https://twitter.com/b/status/1'])).toThrow(
      'invalid_post'
    )
    expect(() => submitted_posts(['https://x.com.attacker.test/a/status/1'])).toThrow('invalid_post')
  })
  test('ranks averages, not totals, and resolves exact ties deterministically', () => {
    const rows = [submission(1, ['11', '12']), submission(2), submission(3)]
    const scores = [
      metric(1, 50, '11'),
      metric(1, 50, '12'),
      metric(2, 60),
      { ...metric(3, 0), reposts: 10, quotes: 10 },
    ]
    expect(rank_social(rows, scores).map(({ user_id }) => user_id)).toEqual(['2', '3', '1'])
  })
  test('pins 48/130 caps and the rounded 70 SUI Member cap', () => {
    expect(tier_slots('veteran')).toBe(48)
    expect(tier_slots('member')).toBe(130)
    expect(cap_mist('veteran')).toBe(125000000000n)
    expect(cap_mist('member')).toBe(70000000000n)
    expect(sui_amount(cap_mist('member'))).toBe('70')
    expect(Number(cap_mist('veteran')) / Number(cap_mist('member'))).toBeCloseTo(1.78571429)
    expect(cap_mist('veteran') * 48n + cap_mist('member') * 130n).toBe(15100000000000n)
  })
  test('walks below duplicates, awards players first, and transfers vacancies at the same tier', () => {
    const reserved: Award[] = [{ address: address(1), tier: 'veteran', source: 'existing', evidence: 'existing' }]
    const boards = [
      { metric: 'xp', addresses: [address(1), address(2), address(3)] },
      { metric: 'kills', addresses: [address(2), address(3), address(4)] },
    ]
    const social = rank_social(
      Array.from({ length: 150 }, (_, index) => submission(index + 1)),
      Array.from({ length: 150 }, (_, index) => metric(index + 1, 1000 - index))
    )
    const result = select_awards(reserved, boards, social)
    expect(result.filter(({ source }) => source === 'leaderboard').map(({ address: value }) => value)).toEqual([
      address(2),
      address(3),
      address(4),
    ])
    expect(result.filter(({ source, tier }) => source === 'social' && tier === 'veteran')).toHaveLength(14)
    expect(result.filter(({ source, tier }) => source === 'social' && tier === 'member')).toHaveLength(113)
    expect(new Set(result.map(({ address: value }) => value)).size).toBe(result.length)
    expect(reserved).toHaveLength(1)
  })
  test('CSV contains exact normalized addresses and decimal caps, no spreadsheet formulas', () => {
    expect(blast_csv([{ address: '0x1', tier: 'veteran', source: 'manual', evidence: '=unsafe' }])).toBe(
      `address,cap_sui,cap_mist\n${address(1)},125,125000000000\n`
    )
    expect(() => blast_csv([{ address: '=unsafe', tier: 'member', source: 'social', evidence: '' }])).toThrow(
      'invalid_address'
    )
  })
})

test('accepts standard X mobile, web and media links without changing duplicate detection', () => {
  expect(
    submitted_posts(['https://x.com/i/web/status/123?x=1', 'https://mobile.twitter.com/user/status/456/photo/1'])
  ).toEqual(['123', '456'])
  expect(() => submitted_posts(['https://x.com/user/status/123', 'https://x.com/i/web/status/123'])).toThrow(
    'invalid_post'
  )
})
