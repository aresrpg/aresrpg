// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync as read_file_sync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import {
  build_github_issue,
  build_update_comment,
  decide_triage,
  fingerprint_from_event,
  materially_grew,
  qualify_for_filing,
  run_triage,
  sentry_count_marker,
  sentry_issue_marker,
} from './sentry_triage.mjs'

const read_fixture = (name) =>
  JSON.parse(read_file_sync(new URL(`./fixtures/sentry_triage/${name}`, import.meta.url), 'utf8'))

const [sentry_issue] = read_fixture('sentry_issues.json')
const latest_event = read_fixture('sentry_latest_event.json')
const github_search = read_fixture('github_search.json')
const github_comments = read_fixture('github_comments.json')
const flood = read_fixture('flood_2026_08_02.json')

// The valve reads a clock, so every run below pins one. `sentry_issue` was last seen
// 2026-07-22T03:04Z; this is six hours later — inside the freshness window, so the fixture stays
// the qualifying case it has always been instead of aging out of the suite.
const fixture_now_ms = Date.parse('2026-07-22T09:00:00Z')

describe('material Sentry growth', () => {
  it('requires both the five-event floor and 25 percent growth', () => {
    expect(materially_grew(1, 5)).toBe(false)
    expect(materially_grew(1, 6)).toBe(true)
    expect(materially_grew(100, 124)).toBe(false)
    expect(materially_grew(100, 125)).toBe(true)
  })
})

describe('marker-based dedupe and updates', () => {
  it('creates when no exact sentry-id marker exists', () => {
    expect(decide_triage(sentry_issue, [], [])).toEqual({ action: 'create' })

    const near_match = github_search.items.map((issue) => ({
      ...issue,
      body: issue.body.replace('sentry_issue_id=991234', 'sentry_issue_id=9912340'),
    }))
    expect(decide_triage(sentry_issue, near_match, [])).toEqual({ action: 'create' })

    const inline_match = github_search.items.map((issue) => ({
      ...issue,
      body: `Fingerprint: \`${sentry_issue_marker(sentry_issue.id)}\``,
    }))
    expect(decide_triage(sentry_issue, inline_match, [])).toEqual({ action: 'create' })
  })

  it('does nothing below the material-growth boundary', () => {
    const issue = { ...sentry_issue, count: '124' }
    expect(decide_triage(issue, github_search.items, [])).toEqual({
      action: 'noop',
      issue_number: 29,
      reported_count: 100,
    })
  })

  it('requalifies the matching GitHub issue rather than filing a second row when it is closed', () => {
    expect(github_search.items[0].state).toBe('closed')
    expect(decide_triage(sentry_issue, github_search.items, [])).toEqual({
      action: 'comment',
      issue_number: 29,
      previous_count: 100,
      reopen: true,
    })
  })

  it('uses the latest reported count from comments instead of the initial body', () => {
    expect(decide_triage({ ...sentry_issue, count: '137' }, github_search.items, github_comments)).toEqual({
      action: 'noop',
      issue_number: 29,
      reported_count: 110,
    })
    expect(decide_triage({ ...sentry_issue, count: '138' }, github_search.items, github_comments)).toEqual({
      action: 'comment',
      issue_number: 29,
      previous_count: 110,
      reopen: true,
    })
  })

  it('ignores marker blocks forged by public commenters', () => {
    const forged_comment = {
      body: `${sentry_issue_marker(sentry_issue.id)}\n${sentry_count_marker(999_999)}`,
      user: { login: 'mallory', type: 'User' },
    }
    expect(decide_triage(sentry_issue, github_search.items, [forged_comment])).toEqual({
      action: 'comment',
      issue_number: 29,
      previous_count: 100,
      reopen: true,
    })
  })

  it('does not dedupe against an issue carrying a marker from an untrusted author', () => {
    const forged_issue = {
      ...github_search.items[0],
      user: { login: 'mallory', type: 'User' },
    }
    expect(decide_triage(sentry_issue, [forged_issue], [])).toEqual({ action: 'create' })
  })
})

describe('GitHub payloads', () => {
  it('files the required title, evidence, link, and machine-readable markers', () => {
    const fingerprint = fingerprint_from_event(latest_event)
    const payload = build_github_issue(sentry_issue, fingerprint)

    expect(payload.title).toBe('RedisError: checkpoint::consume')
    expect(payload.body).toContain('Fingerprint: `rpc-indexer | checkpoint-consume`')
    expect(payload.body).toContain('Event count: 125')
    expect(payload.body).toContain('First seen: 2026-07-21T01:02:03.000Z')
    expect(payload.body).toContain('Last seen: 2026-07-22T03:04:05.000Z')
    expect(payload.body).toContain(sentry_issue.permalink)
    expect(payload.body).toContain(sentry_issue_marker(sentry_issue.id))
    expect(payload.body).toContain(sentry_count_marker(125))
  })

  it('neutralizes marker syntax supplied by Sentry fields', () => {
    const forged_id = '777'
    const fingerprint = [sentry_issue_marker(forged_id), sentry_count_marker(999_999)]
    const payload = build_github_issue(sentry_issue, fingerprint)

    expect(payload.body).not.toContain(sentry_issue_marker(forged_id))
    expect(payload.body).not.toContain(sentry_count_marker(999_999))
    expect(payload.body).toContain(sentry_issue_marker(sentry_issue.id))
  })

  it('carries no state field — a reopen rides its own request, never the comment body', () => {
    const payload = build_update_comment(sentry_issue, 100)
    expect(Object.keys(payload)).toEqual(['body'])
    expect(payload.body).toContain('100 → 125')
    expect(payload.body).toContain(sentry_issue_marker(sentry_issue.id))
    expect(payload.body).toContain(sentry_count_marker(125))
  })
})

const json_response = (data) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

const triage_config = (fetch_fn, sleep) => ({
  sentry_auth_token: 'test-sentry-token',
  sentry_org: 'aresrpg',
  sentry_project: 'indexer',
  github_token: 'test-github-token',
  github_repository: 'sceat/aresrpg',
  fetch_fn,
  sleep,
  now_ms: fixture_now_ms,
  log: () => undefined,
})

describe('rate-limited API edge', () => {
  it('fails closed when GitHub reports an incomplete search', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 0, incomplete_results: true, items: [] })
      throw new Error(`unexpected request: ${url}`)
    }

    await expect(run_triage(triage_config(fetch_fn, async () => undefined))).rejects.toThrow(
      'incomplete GitHub issue search'
    )
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('fails closed when GitHub search results extend beyond the returned page', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 101, incomplete_results: false, items: [] })
      throw new Error(`unexpected request: ${url}`)
    }

    await expect(run_triage(triage_config(fetch_fn, async () => undefined))).rejects.toThrow(
      'incomplete GitHub issue search'
    )
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('uses exponential backoff when a retryable response omits rate-limit headers', async () => {
    const delays = []
    let sentry_attempt = 0
    const fetch_fn = async (url) => {
      if (!String(url).includes('/projects/aresrpg/indexer/issues/')) throw new Error(`unexpected request: ${url}`)
      sentry_attempt += 1
      if (sentry_attempt === 1) return new Response('temporary failure', { status: 500 })
      return json_response([])
    }

    expect(await run_triage(triage_config(fetch_fn, async (delay_ms) => delays.push(delay_ms)))).toEqual({
      create: 0,
      comment: 0,
      noop: 0,
    })
    expect(delays).toEqual([250, 1000, 0])
  })

  it('retries a GitHub secondary-limit 403 carrying Retry-After', async () => {
    let search_attempt = 0
    const fetch_fn = async (url) => {
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues')) {
        search_attempt += 1
        if (search_attempt === 1)
          return new Response('secondary rate limit', { status: 403, headers: { 'Retry-After': '0' } })
        return json_response({ total_count: 0, incomplete_results: false, items: [] })
      }
      if (String(url).includes('/events/latest/')) return json_response(latest_event)
      if (String(url).endsWith('/repos/sceat/aresrpg/issues')) return json_response({ number: 30 })
      throw new Error(`unexpected request: ${url}`)
    }

    expect(await run_triage(triage_config(fetch_fn, async () => undefined))).toEqual({
      create: 1,
      comment: 0,
      noop: 0,
    })
    expect(search_attempt).toBe(2)
  })

  it('defers to the next run instead of shortening a long server rate limit', async () => {
    let request_count = 0
    const fetch_fn = async (url) => {
      request_count += 1
      if (!String(url).includes('/projects/aresrpg/indexer/issues/')) throw new Error(`unexpected request: ${url}`)
      return new Response('rate limited', { status: 429, headers: { 'Retry-After': '61' } })
    }

    await expect(run_triage(triage_config(fetch_fn, async () => undefined))).rejects.toThrow(
      'rate-limit wait; deferring to the next run'
    )
    expect(request_count).toBe(1)
  })

  it('creates once after an exact-marker search miss and never uses a mutating verb beyond POST', async () => {
    const requests = []
    const delays = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method, body: options.body })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 0, incomplete_results: false, items: [] })
      if (String(url).includes('/events/latest/')) return json_response(latest_event)
      if (String(url).endsWith('/repos/sceat/aresrpg/issues')) return json_response({ number: 30 })
      throw new Error(`unexpected request: ${url}`)
    }

    expect(await run_triage(triage_config(fetch_fn, async (delay_ms) => delays.push(delay_ms)))).toEqual({
      create: 1,
      comment: 0,
      noop: 0,
    })
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET', 'GET', 'POST'])
    expect(requests.every((request) => !['PATCH', 'PUT', 'DELETE'].includes(request.method))).toBe(true)
    expect(JSON.parse(requests[3].body).body).toContain(sentry_issue_marker(sentry_issue.id))
    expect(delays).toContain(2100)
  })

  it('does not replay an ambiguous failed GitHub POST', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 0, incomplete_results: false, items: [] })
      if (String(url).includes('/events/latest/')) return json_response(latest_event)
      if (String(url).endsWith('/repos/sceat/aresrpg/issues'))
        return new Response('ambiguous upstream failure', { status: 500 })
      throw new Error(`unexpected request: ${url}`)
    }

    await expect(run_triage(triage_config(fetch_fn, async () => undefined))).rejects.toThrow('github API 500')
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })

  it('updates an existing closed issue without fetching a fingerprint or filing a duplicate', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method, body: options.body })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues')) return json_response(github_search)
      if (String(url).endsWith('/issues/29/comments?per_page=100')) return json_response([])
      if (String(url).endsWith('/issues/29/comments')) return json_response({ id: 1002 })
      if (String(url).endsWith('/issues/29')) return json_response({ number: 29, state: 'open' })
      throw new Error(`unexpected request: ${url}`)
    }

    expect(await run_triage(triage_config(fetch_fn, async () => undefined))).toEqual({
      create: 0,
      comment: 1,
      noop: 0,
    })
    expect(requests.some((request) => request.url.includes('/events/latest/'))).toBe(false)
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(JSON.parse(requests.at(-1).body).body).toContain('100 → 125')
  })
})

// #1991 — the flood, replayed from the run's own inputs (see the fixture's _provenance). The
// board is a work queue, not a mirror of Sentry: an unresolved backlog is not 92 work units.
describe('the valve (#1991)', () => {
  const flood_run_ms = Date.parse(flood.run_at)

  it('refuses every member of the measured flood, each for a named reason', () => {
    expect(flood.issues.map((issue) => qualify_for_filing(issue, flood_run_ms).qualified)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
    const reasons = flood.issues.map((issue) => qualify_for_filing(issue, flood_run_ms).reason.split(' ')[0])
    // Each of the three filters is load-bearing on real inputs, and none of them alone would have
    // held the valve shut: the dev-server row dies on its origin, three week-old rows on freshness,
    // and #1899 — first seen two hours BEFORE the run, so perfectly fresh — only on the severity
    // floor. Drop any one filter and part of this flood files.
    expect(reasons).toEqual([
      'below-severity-floor',
      'stale-fingerprint',
      'stale-fingerprint',
      'local-origin',
      'stale-fingerprint',
    ])
  })

  it('files nothing when it reads the whole flood through the real run', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response(flood.issues)
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 0, incomplete_results: false, items: [] })
      throw new Error(`unexpected request: ${url}`)
    }

    expect(await run_triage({ ...triage_config(fetch_fn, async () => undefined), now_ms: flood_run_ms })).toEqual({
      create: 0,
      comment: 0,
      noop: 5,
    })
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('aborts a run that would file more rows than a human reviews, before any mutation', async () => {
    // Six qualifying rows: past the five-row ceiling, so the run is anomalous by construction and
    // files NOTHING. A backlog drain is never a valid run — it is a bug in the valve upstream.
    const qualifying = Array.from({ length: 6 }, (_, index) => ({
      ...flood.issues[0],
      id: String(200000000 + index),
      permalink: `https://aresrpg.sentry.io/issues/${200000000 + index}/`,
      count: '400',
      lastSeen: flood.run_at,
    }))
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response(qualifying)
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 0, incomplete_results: false, items: [] })
      if (String(url).includes('/events/latest/')) return json_response(latest_event)
      throw new Error(`unexpected request: ${url}`)
    }

    await expect(
      run_triage({ ...triage_config(fetch_fn, async () => undefined), now_ms: flood_run_ms })
    ).rejects.toThrow('would file 6 rows in one run')
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('reopens the row a fingerprint requalifies against instead of filing a duplicate', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method, body: options.body })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues')) return json_response(github_search)
      if (String(url).endsWith('/issues/29/comments?per_page=100')) return json_response([])
      if (String(url).endsWith('/issues/29/comments')) return json_response({ id: 1002 })
      if (String(url).endsWith('/issues/29')) return json_response({ number: 29, state: 'open' })
      throw new Error(`unexpected request: ${url}`)
    }

    expect(await run_triage({ ...triage_config(fetch_fn, async () => undefined), now_ms: fixture_now_ms })).toEqual({
      create: 0,
      comment: 1,
      noop: 0,
    })
    const mutations = requests.filter((request) => request.method !== 'GET')
    expect(mutations.map((request) => request.method)).toEqual(['PATCH', 'POST'])
    expect(JSON.parse(mutations[0].body)).toEqual({ state: 'open' })
    // Exactly one row exists for this fingerprint, before and after.
    expect(requests.some((request) => request.url.endsWith('/repos/sceat/aresrpg/issues'))).toBe(false)
  })

  it('mutates nothing in dry-run and reports the plan it would have executed', async () => {
    const requests = []
    const logged = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues'))
        return json_response({ total_count: 0, incomplete_results: false, items: [] })
      if (String(url).includes('/events/latest/')) return json_response(latest_event)
      throw new Error(`unexpected request: ${url}`)
    }

    expect(
      await run_triage({
        ...triage_config(fetch_fn, async () => undefined),
        now_ms: fixture_now_ms,
        dry_run: true,
        log: (message) => logged.push(message),
      })
    ).toEqual({ create: 1, comment: 0, noop: 0 })
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
    expect(logged.join('\n')).toContain('DRY RUN')
    expect(logged.join('\n')).toContain('create Sentry 991234')
  })
})
