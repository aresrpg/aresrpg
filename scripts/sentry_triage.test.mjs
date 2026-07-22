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

  it('comments at the boundary even when the matching GitHub issue is closed', () => {
    expect(github_search.items[0].state).toBe('closed')
    expect(decide_triage(sentry_issue, github_search.items, [])).toEqual({
      action: 'comment',
      issue_number: 29,
      previous_count: 100,
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

  it('comments the new count without closing or reopening the issue', () => {
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

  it('comments an existing closed issue without fetching a fingerprint or filing a duplicate', async () => {
    const requests = []
    const fetch_fn = async (url, options) => {
      requests.push({ url: String(url), method: options.method, body: options.body })
      if (String(url).includes('/projects/aresrpg/indexer/issues/')) return json_response([sentry_issue])
      if (String(url).includes('/search/issues')) return json_response(github_search)
      if (String(url).endsWith('/issues/29/comments?per_page=100')) return json_response([])
      if (String(url).endsWith('/issues/29/comments')) return json_response({ id: 1002 })
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
