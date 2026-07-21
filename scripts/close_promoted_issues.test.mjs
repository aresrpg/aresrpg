// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  close_promoted_issues,
  extract_close_references,
  plan_issue_closures,
  promotion_comment,
  walk_promoted_range,
} from './close_promoted_issues.mjs'

const REPOSITORY = 'aresrpg/aresrpg'

describe('extract_close_references', () => {
  test('recognizes every GitHub close-keyword form case-insensitively', () => {
    const body = [
      'close #1',
      'Closes: #2',
      'CLOSED #3',
      'fix #4',
      'Fixes: #5',
      'FIXED #6',
      'resolve #7',
      'Resolves: #8',
      'RESOLVED #9',
    ].join('\n')

    expect(extract_close_references(body, REPOSITORY)).toEqual(
      Array.from({ length: 9 }, (_, index) => ({
        repository: REPOSITORY,
        issue_number: index + 1,
      }))
    )
  })

  test('extracts multiple fully-qualified issue clauses from one body', () => {
    const body = 'Closes #12, fixes #13.\nResolves aresrpg/aresrpg#14'

    expect(extract_close_references(body, REPOSITORY)).toEqual([
      { repository: REPOSITORY, issue_number: 12 },
      { repository: REPOSITORY, issue_number: 13 },
      { repository: REPOSITORY, issue_number: 14 },
    ])
  })

  test('does not mistake References or partial words for close keywords', () => {
    const body = 'References #20\nRelates to #21\nDiscloses #22\nPrefixfixes #23'

    expect(extract_close_references(body, REPOSITORY)).toEqual([])
  })

  test('requires a close keyword for every issue in a list', () => {
    const body = 'Closes #30, #31, and #32; fixes #33'

    expect(extract_close_references(body, REPOSITORY)).toEqual([
      { repository: REPOSITORY, issue_number: 30 },
      { repository: REPOSITORY, issue_number: 33 },
    ])
  })

  test('deduplicates references while preserving their first-seen order', () => {
    const body = 'Closes #40\nFixes #41\nResolved #40'

    expect(extract_close_references(body, REPOSITORY)).toEqual([
      { repository: REPOSITORY, issue_number: 40 },
      { repository: REPOSITORY, issue_number: 41 },
    ])
    expect(extract_close_references(null, REPOSITORY)).toEqual([])
  })

  test('normalizes repository-qualified references without remapping foreign issues', () => {
    const body = 'Fixes AresRPG/AresRPG#50\nResolves Other-Org/Other_Repo#51'

    expect(extract_close_references(body, REPOSITORY)).toEqual([
      { repository: REPOSITORY, issue_number: 50 },
      { repository: 'other-org/other_repo', issue_number: 51 },
    ])
  })

  test('ignores keywords in comments and code examples', () => {
    const body = ['<!-- Closes #60 -->', '`Fixes #61`', '```md', 'Resolves #62', '```', 'Closes #63'].join('\n')

    expect(extract_close_references(body, REPOSITORY)).toEqual([{ repository: REPOSITORY, issue_number: 63 }])
  })
})

describe('walk_promoted_range', () => {
  test('walks commits in compare order and returns each associated PR once', () => {
    const commits = [{ sha: 'commit_a' }, { sha: 'commit_b' }, { sha: 'commit_c' }]
    const first_pr = { number: 101, body: 'Closes #1', base: { repo: { full_name: REPOSITORY } } }
    const second_pr = { number: 102, body: 'Fixes #2', base: { repo: { full_name: REPOSITORY } } }
    const pull_requests_by_sha = {
      commit_a: [first_pr],
      commit_b: [first_pr, second_pr],
      commit_c: [],
    }

    expect(walk_promoted_range(commits, pull_requests_by_sha)).toEqual([first_pr, second_pr])
  })

  test('treats a missing association row as an empty commit', () => {
    const commits = [{ sha: 'commit_without_pr' }]

    expect(walk_promoted_range(commits, {})).toEqual([])
  })
})

describe('plan_issue_closures', () => {
  test('groups each issue with every source PR that supplied its close keyword', () => {
    const pull_requests = [
      {
        number: 201,
        body: 'Closes #70\nFixes Other/Repo#71',
        base: { repo: { full_name: REPOSITORY } },
      },
      {
        number: 202,
        body: 'Resolves #70\nClosed #72',
        base: { repo: { full_name: REPOSITORY } },
      },
    ]

    expect(plan_issue_closures(pull_requests, REPOSITORY)).toEqual([
      {
        repository: REPOSITORY,
        issue_number: 70,
        source_pull_requests: [
          { repository: REPOSITORY, pull_request_number: 201 },
          { repository: REPOSITORY, pull_request_number: 202 },
        ],
      },
      {
        repository: 'other/repo',
        issue_number: 71,
        source_pull_requests: [{ repository: REPOSITORY, pull_request_number: 201 }],
      },
      {
        repository: REPOSITORY,
        issue_number: 72,
        source_pull_requests: [{ repository: REPOSITORY, pull_request_number: 202 }],
      },
    ])
  })
})

describe('promotion_comment', () => {
  test('cites the full promotion SHA and all source PRs', () => {
    const comment = promotion_comment('a'.repeat(40), [
      { repository: REPOSITORY, pull_request_number: 301 },
      { repository: 'other/repo', pull_request_number: 302 },
    ])

    expect(comment).toContain('a'.repeat(40))
    expect(comment).toContain('aresrpg/aresrpg#301')
    expect(comment).toContain('other/repo#302')
  })
})

describe('close_promoted_issues', () => {
  test('is a no-op when no successful promotion SHA was supplied', async () => {
    let fetch_count = 0
    const fetch_fn = async () => {
      fetch_count += 1
      throw new Error('fetch must not run')
    }

    expect(
      await close_promoted_issues({
        before_sha: '',
        promotion_sha: '',
        repository: REPOSITORY,
        token: 'token',
        fetch_fn,
      })
    ).toEqual({
      commit_count: 0,
      pull_request_count: 0,
      referenced_issue_count: 0,
      closed_issue_count: 0,
    })
    expect(fetch_count).toBe(0)
  })

  test('uses the injected fetch, comments before closing, and silently skips closed issues', async () => {
    const calls = []
    const json_response = (value, status = 200) =>
      new Response(status === 204 ? null : JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const fetch_fn = async (url, options = {}) => {
      const method = options.method ?? 'GET'
      calls.push({ url, method, body: options.body })
      if (url.includes('/compare/old_sha...new_sha'))
        return json_response({ status: 'ahead', total_commits: 2, commits: [{ sha: 'one' }, { sha: 'two' }] })
      if (url.includes('/commits/one/pulls'))
        return json_response([
          { number: 401, body: 'Closes #80\nFixes #81', base: { repo: { full_name: REPOSITORY } } },
        ])
      if (url.includes('/commits/two/pulls'))
        return json_response([{ number: 402, body: 'Resolves #80', base: { repo: { full_name: REPOSITORY } } }])
      if (url.endsWith('/issues/80') && method === 'GET') return json_response({ state: 'open' })
      if (url.endsWith('/issues/81') && method === 'GET') return json_response({ state: 'closed' })
      if (url.endsWith('/issues/80/comments') && method === 'POST') return json_response({ id: 1 }, 201)
      if (url.endsWith('/issues/80') && method === 'PATCH') return json_response({ state: 'closed' })
      throw new Error(`unexpected request: ${method} ${url}`)
    }

    expect(
      await close_promoted_issues({
        before_sha: 'old_sha',
        promotion_sha: 'new_sha',
        repository: REPOSITORY,
        token: 'token',
        fetch_fn,
      })
    ).toEqual({
      commit_count: 2,
      pull_request_count: 2,
      referenced_issue_count: 2,
      closed_issue_count: 1,
    })

    const comment_call = calls.find((call) => call.url.endsWith('/issues/80/comments'))
    const close_call = calls.find((call) => call.url.endsWith('/issues/80') && call.method === 'PATCH')
    expect(calls.indexOf(comment_call)).toBeLessThan(calls.indexOf(close_call))
    expect(JSON.parse(comment_call.body).body).toContain('new_sha')
    expect(JSON.parse(comment_call.body).body).toContain('aresrpg/aresrpg#401')
    expect(JSON.parse(comment_call.body).body).toContain('aresrpg/aresrpg#402')
    expect(calls.some((call) => call.url.endsWith('/issues/81/comments'))).toBe(false)
  })
})
