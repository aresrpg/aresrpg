// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The board-hygiene passes' pure cores, plus one end-to-end drive of the landing sweep over a mock
// GitHub (a fixture PR body carrying real close-keyword lines against a mock open-issue set).
import { readFileSync as read_file_sync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import {
  BOT_LOGIN,
  EXEMPT_LABELS,
  STALE_WARNING_LABEL,
  decide_landing,
  decide_ref_gate,
  decide_stale,
  is_fix_or_feat,
  landing_marker,
  last_human_activity,
  mentions_issue,
  parse_args,
  parse_close_refs,
  resolve_now,
  run_landing,
} from './board_hygiene.mjs'

const REPOSITORY = 'aresrpg/aresrpg'
const read_fixture = (name) =>
  JSON.parse(read_file_sync(new URL(`./fixtures/board_hygiene/${name}`, import.meta.url), 'utf8'))

const merged_pulls = read_fixture('merged_pulls.json')
const open_issues = read_fixture('open_issues.json')

const DAY_MS = 86_400_000
const now_ms = Date.parse('2026-07-27T12:00:00Z')
const days_ago = (days) => new Date(now_ms - days * DAY_MS).toISOString()

const bot_event = (event, extra = {}) => ({ event, actor: { login: BOT_LOGIN }, ...extra })
const human_event = (event, created_at, extra = {}) => ({ event, actor: { login: 'sceat' }, created_at, ...extra })

describe('close-keyword parsing (the close chain GitHub does not run for us)', () => {
  it('reads every close-keyword form in a real PR body, and only for this repository', () => {
    expect(parse_close_refs(merged_pulls[0].body, REPOSITORY)).toEqual([998, 1039, 965].toSorted((a, b) => a - b))
  })

  it('accepts the whole keyword family and rejects a bare mention', () => {
    const body = 'close #1 closes #2 closed #3 fix #4 fixes #5 fixed #6 resolve #7 resolves #8 resolved #9 see #10'
    expect(parse_close_refs(body, REPOSITORY)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('never matches a keyword welded inside another word', () => {
    expect(parse_close_refs('postfixes #12 and unresolved #13', REPOSITORY)).toEqual([])
  })

  it('dedupes and tolerates the colon form', () => {
    expect(parse_close_refs('Fixes: #21\nfixes #21\nFIXES #21', REPOSITORY)).toEqual([21])
  })

  it('drops a cross-repository ref — this pass may only close its own board', () => {
    expect(parse_close_refs('Fixes othervendor/other#42', REPOSITORY)).toEqual([])
  })
})

describe('the ref gate reads mentions, not close-keywords', () => {
  it('counts any issue reference as "the author thought about the board"', () => {
    expect(mentions_issue('Refs #123')).toBe(true)
    expect(mentions_issue('no rows here')).toBe(false)
  })

  it('only judges conventional fix:/feat: subjects', () => {
    expect(is_fix_or_feat('fix(fight): a thing')).toBe(true)
    expect(is_fix_or_feat('feat!: a thing')).toBe(true)
    expect(is_fix_or_feat('ci(board): a thing')).toBe(false)
    expect(is_fix_or_feat('fixup the thing')).toBe(false)
  })

  it('warns once, then resolves itself when the ref appears', () => {
    const pull = { title: 'fix(sim): a thing', body: 'no ref' }
    const warning = { id: 7, user: { login: BOT_LOGIN }, body: `text\n<!-- board_hygiene ref_gate -->` }
    expect(decide_ref_gate(pull, [], [])).toEqual({ action: 'warn' })
    expect(decide_ref_gate(pull, [], [warning])).toEqual({ action: 'noop', reason: 'already warned' })
    expect(decide_ref_gate({ ...pull, body: 'Fixes #9' }, [], [warning])).toEqual({ action: 'resolve', comment_id: 7 })
    expect(decide_ref_gate({ ...pull, body: 'Fixes #9' }, [], [])).toEqual({ action: 'noop', reason: 'referenced' })
  })

  it('accepts a ref carried by a commit message alone', () => {
    const commits = [{ commit: { message: 'fix(sim): a thing\n\nFixes #9' } }]
    expect(decide_ref_gate({ title: 'fix: a thing', body: '' }, commits, [])).toEqual({
      action: 'noop',
      reason: 'referenced',
    })
  })

  it('leaves a non-fix/feat pull request alone', () => {
    expect(decide_ref_gate({ title: 'chore: bump', body: '' }, [], []).action).toBe('noop')
  })
})

describe('the landing sweep never fights a human', () => {
  const evidence = { sha: 'aaaaaaaaaaaa', pr_number: 1187 }

  it('closes an open row', () => {
    expect(decide_landing({ state: 'open' }, [], evidence)).toEqual({ action: 'close' })
  })

  it('skips a row that is already closed', () => {
    expect(decide_landing({ state: 'closed' }, [], evidence).action).toBe('noop')
  })

  it('skips a row it already swept for this landing — the reopen was deliberate', () => {
    const swept = [{ user: { login: BOT_LOGIN }, body: `body\n${landing_marker(evidence)}` }]
    expect(decide_landing({ state: 'open' }, swept, evidence).action).toBe('noop')
  })

  it('ignores a marker a non-bot account pasted into a comment', () => {
    const spoofed = [{ user: { login: 'someone' }, body: landing_marker(evidence) }]
    expect(decide_landing({ state: 'open' }, spoofed, evidence)).toEqual({ action: 'close' })
  })

  it('keys the marker on the landing, so a later landing can close a reopened row', () => {
    const swept = [{ user: { login: BOT_LOGIN }, body: landing_marker(evidence) }]
    expect(decide_landing({ state: 'open' }, swept, { sha: 'bbbbbbbbbbbb', pr_number: 1200 })).toEqual({
      action: 'close',
    })
  })
})

describe('the stale clock counts human activity only', () => {
  it('ignores this workflow own comments and labels', () => {
    const timeline = [
      human_event('commented', days_ago(30)),
      bot_event('commented', { created_at: days_ago(1) }),
      bot_event('labeled', { created_at: days_ago(1), label: { name: STALE_WARNING_LABEL } }),
    ]
    expect(last_human_activity(timeline, days_ago(60))).toBe(Date.parse(days_ago(30)))
  })

  it('counts a pull-request cross-reference, which updated_at can miss', () => {
    const timeline = [human_event('cross-referenced', days_ago(2)), human_event('subscribed', days_ago(0))]
    expect(last_human_activity(timeline, days_ago(60))).toBe(Date.parse(days_ago(2)))
  })

  it('falls back to the creation date so a brand-new row is never stale', () => {
    expect(last_human_activity([], days_ago(1))).toBe(Date.parse(days_ago(1)))
  })
})

describe('the stale ladder', () => {
  const row = (labels, created_at) => ({ number: 1, title: 't', created_at, labels: labels.map((name) => ({ name })) })

  it('exempts the reserved labels without reading a timeline', () => {
    for (const label of EXEMPT_LABELS)
      expect(decide_stale(row([label], days_ago(400)), [], now_ms)).toEqual({ action: 'exempt', label })
  })

  it('warns at seven days and not before', () => {
    expect(decide_stale(row([], days_ago(7)), [], now_ms).action).toBe('warn')
    expect(decide_stale(row([], days_ago(6)), [], now_ms).action).toBe('noop')
  })

  it('does not close before seven more days have passed since the warning', () => {
    const timeline = [bot_event('labeled', { created_at: days_ago(6), label: { name: STALE_WARNING_LABEL } })]
    expect(decide_stale(row([STALE_WARNING_LABEL], days_ago(90)), timeline, now_ms).action).toBe('noop')
  })

  it('closes seven days after its own warning', () => {
    const timeline = [bot_event('labeled', { created_at: days_ago(7), label: { name: STALE_WARNING_LABEL } })]
    expect(decide_stale(row([STALE_WARNING_LABEL], days_ago(90)), timeline, now_ms).action).toBe('close')
  })

  it('unwarns mechanically when the row moves after the warning', () => {
    const timeline = [
      bot_event('labeled', { created_at: days_ago(9), label: { name: STALE_WARNING_LABEL } }),
      human_event('commented', days_ago(2)),
    ]
    expect(decide_stale(row([STALE_WARNING_LABEL], days_ago(90)), timeline, now_ms).action).toBe('unwarn')
  })

  it('refuses to close on a clock it cannot prove — a hand-applied label grants no grace', () => {
    const timeline = [human_event('labeled', days_ago(60), { label: { name: STALE_WARNING_LABEL } })]
    const decision = decide_stale(row([STALE_WARNING_LABEL], days_ago(90)), timeline, now_ms)
    expect(decision.action).toBe('noop')
    expect(decision.reason).toBe('stale-warning applied outside this workflow')
  })

  it('exempts before anything else — an exempt row is never warned however old', () => {
    const timeline = [bot_event('labeled', { created_at: days_ago(40), label: { name: STALE_WARNING_LABEL } })]
    expect(decide_stale(row(['P1', STALE_WARNING_LABEL], days_ago(400)), timeline, now_ms).action).toBe('exempt')
  })
})

describe('run_landing drives a landing sweep end to end', () => {
  const build_mock = () => {
    const sent = []
    const json_response = (data) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => data,
      text: async () => JSON.stringify(data),
    })
    const fetch_fn = async (url, options = {}) => {
      const { pathname } = new URL(url)
      const method = options.method ?? 'GET'
      if (method !== 'GET') {
        sent.push({ method, pathname, body: JSON.parse(options.body) })
        return json_response({})
      }
      if (pathname === '/repos/aresrpg/aresrpg/pulls') return json_response(merged_pulls)
      const issue_match = /^\/repos\/aresrpg\/aresrpg\/issues\/(\d+)$/.exec(pathname)
      if (issue_match) return json_response(open_issues[issue_match[1]])
      if (/\/issues\/998\/comments$/.test(pathname))
        return json_response([{ user: { login: BOT_LOGIN }, body: landing_marker({ pr_number: 1187 }) }])
      if (/\/comments$/.test(pathname)) return json_response([])
      throw new Error(`unexpected GET ${pathname}`)
    }
    return { sent, fetch_fn }
  }

  const config_for = (fetch_fn, overrides = {}) => ({
    mode: 'backstop',
    repository: REPOSITORY,
    github_token: 'test',
    since_days: 14,
    now_ms,
    dry_run: false,
    fetch_fn,
    sleep: async () => {},
    log: () => {},
    ...overrides,
  })

  it('closes the open referenced rows, cites the landing, and touches nothing else', async () => {
    const { sent, fetch_fn } = build_mock()
    const summary = await run_landing(config_for(fetch_fn))

    // #965 open -> closed. #1039 already closed -> untouched. #998 already swept for this PR (a
    // deliberate reopen) -> untouched. The stale PR (merged 87 days ago) and the unmerged one are
    // outside the window, so #736 and #1300 are never even looked up.
    expect(summary).toEqual({ closed: 1, skipped: 2 })
    expect(sent.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([
      'POST /repos/aresrpg/aresrpg/issues/965/comments',
      'PATCH /repos/aresrpg/aresrpg/issues/965',
    ])
    expect(sent[0].body.body).toContain('Closed by #1187')
    expect(sent[0].body.body).toContain(landing_marker({ pr_number: 1187 }))
    expect(sent[1].body).toEqual({ state: 'closed', state_reason: 'completed' })
  })

  it('sends no mutation at all under --dry-run', async () => {
    const { sent, fetch_fn } = build_mock()
    const summary = await run_landing(config_for(fetch_fn, { dry_run: true }))
    expect(summary).toEqual({ closed: 1, skipped: 2 })
    expect(sent).toEqual([])
  })
})

describe('the CLI edge', () => {
  it('refuses an unknown mode', () => {
    expect(() => parse_args(['sweep-everything'])).toThrow(/usage:/)
    expect(() => parse_args([])).toThrow(/usage:/)
  })

  it('lets only a dry run move its own clock', () => {
    const wall = Date.parse('2026-07-27T12:00:00Z')
    expect(resolve_now({ dry_run: true, as_of: null }, wall)).toBe(wall)
    expect(resolve_now({ dry_run: true, as_of: '2026-08-05' }, wall)).toBe(Date.parse('2026-08-05'))
    expect(() => resolve_now({ dry_run: false, as_of: '2026-08-05' }, wall)).toThrow(/dry-run projection/)
    expect(() => resolve_now({ dry_run: true, as_of: 'next tuesday' }, wall)).toThrow(/ISO date/)
  })

  it('parses the modes and their flags', () => {
    expect(parse_args(['stale', '--dry-run'])).toMatchObject({ mode: 'stale', dry_run: true })
    expect(parse_args(['landing', '--base', 'abc', '--head', 'def'])).toMatchObject({ base: 'abc', head: 'def' })
    expect(parse_args(['ref-gate', '--pr', '42'])).toMatchObject({ pull_number: 42 })
  })
})
