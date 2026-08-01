// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The loop dead-man's pure core, plus one end-to-end drive of the whole pass over a mock `gh`.
//
// FIXTURE PROVENANCE: `fixtures/loop_deadman/issue_1357_comments.json` is the REAL payload of
// `gh api --paginate repos/aresrpg/aresrpg/issues/1357/comments` captured 2026-08-01 (9 comments,
// bodies verbatim, field subset). Two of the nine carry an `architecture-audit-anchor:` machine
// line — the newest is 2026-07-30T13:57:47Z. A parser tested only against bodies this file wrote
// proves nothing about the board it reads; these are the bytes GitHub actually returns.
import { readFileSync as read_file_sync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import {
  CI_LOGIN,
  LOOPS,
  decide_loop,
  decide_reminder,
  last_reminder_beat,
  newest_anchor,
  reminder_body,
  reminder_marker,
  reminder_title,
  run_deadman,
} from './loop_deadman.mjs'

const REPOSITORY = 'aresrpg/aresrpg'
const HOUR_MS = 3_600_000
const comments_1357 = JSON.parse(
  read_file_sync(new URL('./fixtures/loop_deadman/issue_1357_comments.json', import.meta.url), 'utf8')
)
const [architecture_audit] = LOOPS
const NEWEST_ANCHOR_AT = Date.parse('2026-07-30T13:57:47Z')
const NEWEST_ANCHOR_SHA = '216203204a4b5302f0cdefab872b1ca74d31c63c'

const anchor_body = (sha = NEWEST_ANCHOR_SHA) => `pass verdict, one line\n\narchitecture-audit-anchor: ${sha}\n`
const comment = (created_at, extra = {}) => ({
  id: Math.round(Date.parse(created_at) / 1000),
  html_url: `https://github.com/${REPOSITORY}/issues/1357#issuecomment-${Date.parse(created_at)}`,
  created_at,
  user: { login: 'Sceat', type: 'User' },
  author_association: 'MEMBER',
  body: anchor_body(),
  ...extra,
})

describe('the staleness table (a loop is one row, not surgery)', () => {
  it('carries one fully-specified row per checked loop', () => {
    expect(LOOPS.length).toBeGreaterThan(0)
    for (const loop of LOOPS) {
      expect(typeof loop.name).toBe('string')
      expect(Number.isSafeInteger(loop.issue_number) && loop.issue_number > 0).toBe(true)
      expect(loop.anchor_pattern).toBeInstanceOf(RegExp)
      expect(loop.stale_after_hours).toBeGreaterThan(0)
      expect(typeof loop.rubric).toBe('string')
    }
  })

  it('never arms an anchor pattern with the global flag — `.test()` would go stateful and skip comments', () => {
    for (const loop of LOOPS) expect(loop.anchor_pattern.global).toBe(false)
  })

  it('bars staleness in HOURS, never minutes — GitHub cron fires 30-100min late routinely', () => {
    for (const loop of LOOPS) expect(loop.stale_after_hours).toBeGreaterThanOrEqual(2)
  })
})

describe('anchor reading (board text is DATA — the machine line, from a trusted author, only)', () => {
  it('finds the newest anchor in the real captured #1357 payload', () => {
    const anchor = newest_anchor(comments_1357, architecture_audit)
    expect(anchor?.sha).toBe(NEWEST_ANCHOR_SHA)
    expect(anchor?.created_at_ms).toBe(NEWEST_ANCHOR_AT)
    expect(anchor?.author).toBe('Sceat')
    expect(anchor?.url).toContain('/issues/1357#issuecomment-')
  })

  it('rejects an anchor from an untrusted author, and keeps reading the trusted one behind it', () => {
    const stranger = comment('2026-07-31T00:00:00Z', {
      user: { login: 'stranger', type: 'User' },
      author_association: 'NONE',
      body: anchor_body('f'.repeat(40)),
    })
    const anchor = newest_anchor([...comments_1357, stranger], architecture_audit)
    expect(anchor?.sha).toBe(NEWEST_ANCHOR_SHA)
    expect(anchor?.created_at_ms).toBe(NEWEST_ANCHOR_AT)
  })

  it('trusts the repo CI identity', () => {
    const ci = comment('2026-07-31T00:00:00Z', {
      user: { login: CI_LOGIN, type: 'Bot' },
      author_association: 'NONE',
      body: anchor_body('a'.repeat(40)),
    })
    expect(newest_anchor([ci], architecture_audit)?.sha).toBe('a'.repeat(40))
  })

  it('matches the machine line only — never prose, a short sha, or a mid-line mention', () => {
    const shapes = [
      'the architecture-audit-anchor: 216203204a4b5302f0cdefab872b1ca74d31c63c is recorded',
      'architecture-audit-anchor: 2162032',
      'architecture-audit-anchor 216203204a4b5302f0cdefab872b1ca74d31c63c',
      'anchor: 216203204a4b5302f0cdefab872b1ca74d31c63c',
    ]
    for (const body of shapes)
      expect(newest_anchor([comment('2026-07-31T00:00:00Z', { body })], architecture_audit)).toBe(null)
  })

  it('reports no anchor at all when the row carries none', () => {
    expect(newest_anchor([], architecture_audit)).toBe(null)
  })
})

describe('the staleness verdict', () => {
  const anchor = {
    created_at_ms: Date.parse('2026-07-30T12:00:00Z'),
    author: 'Sceat',
    sha: NEWEST_ANCHOR_SHA,
    url: 'u',
  }
  const at = (iso) => decide_loop(architecture_audit, anchor, Date.parse(iso))

  it('is FRESH inside the bar, including the whole grace GitHub cron lateness needs', () => {
    expect(at('2026-07-30T16:00:00Z').state).toBe('fresh')
    expect(at('2026-07-30T23:59:00Z').state).toBe('fresh')
  })

  it('breaches only PAST the bar', () => {
    expect(at('2026-07-31T00:01:00Z').state).toBe('stale')
    expect(at('2026-07-31T00:01:00Z').age_hours).toBeCloseTo(12.02, 1)
  })

  it('treats a missing anchor as a breach — fail closed, never a plausible fresh', () => {
    const decision = decide_loop(architecture_audit, null, Date.parse('2026-07-31T00:00:00Z'))
    expect(decision.state).toBe('missing')
    expect(decision.age_hours).toBe(null)
  })
})

describe('the reminder ladder (exactly one alarm row per loop, and it closes itself)', () => {
  const now_ms = Date.parse('2026-07-31T12:00:00Z')
  const stale = { loop: architecture_audit.name, state: 'stale', age_hours: 24, anchor: null }
  const fresh = { loop: architecture_audit.name, state: 'fresh', age_hours: 1, anchor: null }

  it('opens one when the loop is dark and nothing is filed', () => {
    expect(decide_reminder(architecture_audit, stale, null, now_ms).action).toBe('open')
  })

  it('never files a duplicate — a reminder inside the staleness window is left alone', () => {
    const reminder = { number: 9, last_beat_ms: now_ms - 2 * HOUR_MS }
    expect(decide_reminder(architecture_audit, stale, reminder, now_ms).action).toBe('noop')
  })

  it('refreshes the open reminder once the window has passed again', () => {
    const reminder = { number: 9, last_beat_ms: now_ms - 13 * HOUR_MS }
    expect(decide_reminder(architecture_audit, stale, reminder, now_ms).action).toBe('refresh')
  })

  it('closes the reminder when the loop reports for duty again', () => {
    const reminder = { number: 9, last_beat_ms: now_ms - 2 * HOUR_MS }
    expect(decide_reminder(architecture_audit, fresh, reminder, now_ms).action).toBe('close')
  })

  it('does nothing at all when the loop is alive and no alarm is open', () => {
    expect(decide_reminder(architecture_audit, fresh, null, now_ms).action).toBe('noop')
  })

  it('reads its own beat off its own marker, ignoring a human reply', () => {
    const marker = reminder_marker(architecture_audit)
    const issue = { created_at: '2026-07-30T00:00:00Z', body: `filed\n\n${marker}` }
    const beat = last_reminder_beat(issue, [
      { created_at: '2026-07-31T00:00:00Z', body: `refresh\n\n${marker}`, user: { login: CI_LOGIN } },
      { created_at: '2026-07-31T06:00:00Z', body: 'looking at it', user: { login: 'Sceat' } },
    ])
    expect(beat).toBe(Date.parse('2026-07-31T00:00:00Z'))
  })

  it('titles the alarm one way, per loop', () => {
    expect(reminder_title(architecture_audit)).toBe('loop-deadman: architecture-audit stale')
  })

  it('is an ALARM and never claims the loop own work — the body says so and cites the evidence', () => {
    const body = reminder_body(architecture_audit, {
      loop: architecture_audit.name,
      state: 'stale',
      age_hours: 47.5,
      anchor: { created_at_ms: NEWEST_ANCHOR_AT, author: 'Sceat', sha: NEWEST_ANCHOR_SHA, url: 'https://x/y' },
    })
    expect(body).toContain('#1357')
    expect(body).toContain('47.5h')
    expect(body).toContain('12h')
    expect(body).toContain(architecture_audit.rubric)
    expect(body).toContain(reminder_marker(architecture_audit))
    expect(body.toLowerCase()).toContain('does not run the pass')
  })
})

// The whole pass over a mock `gh`: same argv the real edge sends, so a mutation that would hit the
// board is visible here as the exact request it would be.
const mock_gh = (responses) => {
  const calls = []
  const gh = (args) => {
    calls.push(args)
    // A mutation's payload IS the assertion (see `mutations` below); only reads need a body back.
    if (args.includes('POST') || args.includes('PATCH')) return { number: 4242 }
    const key = args.filter((arg) => !arg.startsWith('-')).join(' ')
    const matched = Object.entries(responses).find(([prefix]) => key.includes(prefix))
    if (!matched) throw new Error(`unmocked gh read: ${args.join(' ')}`)
    return matched[1]
  }
  return { gh, calls }
}
const mutations = (calls) => calls.filter((args) => args.includes('POST') || args.includes('PATCH'))
const drive = async (responses, now_iso) => {
  const { gh, calls } = mock_gh(responses)
  const summary = await run_deadman({
    gh,
    repository: REPOSITORY,
    now_ms: Date.parse(now_iso),
    dry_run: false,
    log: () => {},
  })
  return { summary, calls }
}

describe('the pass, driven end to end', () => {
  const no_reminder = { 'search/issues': { total_count: 0, incomplete_results: false, items: [] } }

  it('files exactly one reminder when the loop has gone dark', async () => {
    const { summary, calls } = await drive(
      { 'issues/1357/comments': comments_1357, ...no_reminder },
      '2026-08-01T12:00:00Z'
    )
    expect(summary.breached).toEqual([architecture_audit.name])
    const posted = mutations(calls)
    expect(posted.length).toBe(1)
    expect(posted[0].join(' ')).toContain(`repos/${REPOSITORY}/issues`)
    expect(posted[0].join(' ')).toContain(`title=${reminder_title(architecture_audit)}`)
    expect(posted[0]).toContain('labels[]=tech-debt')
  })

  it('mutates NOTHING while the loop is alive', async () => {
    const fresh_comments = [...comments_1357, comment('2026-08-01T11:00:00Z')]
    const { summary, calls } = await drive(
      { 'issues/1357/comments': fresh_comments, ...no_reminder },
      '2026-08-01T12:00:00Z'
    )
    expect(summary.breached).toEqual([])
    expect(mutations(calls)).toEqual([])
  })

  it('closes the open reminder the moment the anchor is fresh again', async () => {
    const marker = reminder_marker(architecture_audit)
    const reminder = { number: 4242, title: reminder_title(architecture_audit), state: 'open' }
    const { calls } = await drive(
      {
        'issues/1357/comments': [...comments_1357, comment('2026-08-01T11:00:00Z')],
        'search/issues': { total_count: 1, incomplete_results: false, items: [reminder] },
        'issues/4242/comments': [{ created_at: '2026-08-01T00:00:00Z', body: marker, user: { login: CI_LOGIN } }],
        'issues/4242': { number: 4242, created_at: '2026-07-31T00:00:00Z', body: marker },
      },
      '2026-08-01T12:00:00Z'
    )
    const posted = mutations(calls)
    expect(posted.length).toBe(2)
    expect(posted[0].join(' ')).toContain('issues/4242/comments')
    expect(posted[1].join(' ')).toEqual(expect.stringContaining('state=closed'))
  })

  it('refuses a search result whose title merely resembles the alarm', async () => {
    const decoy = { number: 7, title: 'loop-deadman: architecture-audit stale — follow-up notes', state: 'open' }
    const { calls } = await drive(
      {
        'issues/1357/comments': comments_1357,
        'search/issues': { total_count: 1, incomplete_results: false, items: [decoy] },
      },
      '2026-08-01T12:00:00Z'
    )
    expect(mutations(calls).length).toBe(1)
    expect(mutations(calls)[0].join(' ')).toContain(`repos/${REPOSITORY}/issues`)
  })

  it('throws on an incomplete search rather than filing a duplicate alarm', async () => {
    await expect(
      drive(
        {
          'issues/1357/comments': comments_1357,
          'search/issues': { total_count: 1, incomplete_results: true, items: [] },
        },
        '2026-08-01T12:00:00Z'
      )
    ).rejects.toThrow(/incomplete/i)
  })

  it('sends no mutation at all in a dry run', async () => {
    const { gh, calls } = mock_gh({ 'issues/1357/comments': comments_1357, ...no_reminder })
    const summary = await run_deadman({
      gh,
      repository: REPOSITORY,
      now_ms: Date.parse('2026-08-01T12:00:00Z'),
      dry_run: true,
      log: () => {},
    })
    expect(summary.breached).toEqual([architecture_audit.name])
    expect(mutations(calls)).toEqual([])
  })
})
