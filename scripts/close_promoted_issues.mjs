#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CLOSE LEG (issue #362): GitHub only applies PR-body close keywords when a PR merges into the
// default branch. Feature PRs land on edge and the release PR reaches master by a raw fast-forward,
// so neither event applies those keywords. Walk old_master..promotion_sha, recover every associated
// source PR, and replay the same close intent after the master push has succeeded.
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const API_VERSION = '2022-11-28'
const PAGE_SIZE = 100
const ASSOCIATION_BATCH_SIZE = 8

const empty_result = () => ({
  commit_count: 0,
  pull_request_count: 0,
  referenced_issue_count: 0,
  closed_issue_count: 0,
})

const normalize_repository = (repository) => (typeof repository === 'string' ? repository.trim().toLowerCase() : '')

const repository_path = (repository) => {
  const normalized_repository = normalize_repository(repository)
  const [owner, name, ...remainder] = normalized_repository.split('/')
  if (!owner || !name || remainder.length > 0) throw new Error(`invalid GitHub repository: ${repository}`)
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

const without_inline_code = (line) => {
  const prose = []
  let cursor = 0
  while (cursor < line.length) {
    const opening_start = line.indexOf('`', cursor)
    if (opening_start < 0) {
      prose.push(line.slice(cursor))
      break
    }
    let opening_end = opening_start
    while (line[opening_end] === '`') opening_end += 1
    const delimiter = line.slice(opening_start, opening_end)
    const closing_start = line.indexOf(delimiter, opening_end)
    if (closing_start < 0) {
      prose.push(line.slice(cursor))
      break
    }
    prose.push(line.slice(cursor, opening_start))
    cursor = closing_start + delimiter.length
  }
  return prose.join('')
}

// Closing examples in templates/comments/code are inert on GitHub. Mask those non-prose regions
// before scanning so a copied example cannot close a real issue during a promotion.
const closing_prose = (body) => {
  const without_comments = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const lines = without_comments.split('\n')
  let fence = null
  return lines
    .map((line) => {
      const fence_match = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (fence) {
        const closing_match = line.match(/^ {0,3}(`+|~+)[ \t]*$/)
        if (closing_match && closing_match[1][0] === fence.marker && closing_match[1].length >= fence.length)
          fence = null
        return ''
      }
      if (fence_match) {
        fence = { marker: fence_match[1][0], length: fence_match[1].length }
        return ''
      }
      if (/^(?: {4}|\t)/.test(line)) return ''
      return without_inline_code(line)
    })
    .join('\n')
}

/**
 * Pure GitHub close-keyword parser. Each issue needs its own keyword, matching GitHub's documented
 * close/closes/closed, fix/fixes/fixed, and resolve/resolves/resolved forms (case-insensitive).
 */
export function extract_close_references(body, repository) {
  if (typeof body !== 'string' || body.length === 0) return []
  const default_repository = normalize_repository(repository)
  const close_pattern =
    /(?:^|[^\p{L}\p{N}_])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:(?<repository>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#(?<issue_number>[1-9]\d*)\b/giu
  const references = []
  const seen = new Set()
  for (const match of closing_prose(body).matchAll(close_pattern)) {
    const target_repository = normalize_repository(match.groups?.repository ?? default_repository)
    const issue_number = Number(match.groups?.issue_number)
    if (!target_repository || !Number.isSafeInteger(issue_number)) continue
    const key = `${target_repository}#${issue_number}`
    if (seen.has(key)) continue
    seen.add(key)
    references.push({ repository: target_repository, issue_number })
  }
  return references
}

const pull_request_repository = (pull_request, fallback_repository = '') =>
  normalize_repository(pull_request?.base?.repo?.full_name ?? fallback_repository)

/** Pure commit-order walk: flatten commit→PR association rows and retain each source PR once. */
export function walk_promoted_range(commits, pull_requests_by_sha) {
  const pull_requests = []
  const seen = new Set()
  for (const commit of commits) {
    const commit_pull_requests = pull_requests_by_sha[commit?.sha] ?? []
    for (const pull_request of commit_pull_requests) {
      const source_repository = pull_request_repository(pull_request)
      const pull_request_number = Number(pull_request?.number)
      if (!source_repository || !Number.isSafeInteger(pull_request_number)) continue
      const key = `${source_repository}#${pull_request_number}`
      if (seen.has(key)) continue
      seen.add(key)
      pull_requests.push(pull_request)
    }
  }
  return pull_requests
}

/** Pure close plan: one target issue, with every PR whose body supplied its closing keyword. */
export function plan_issue_closures(pull_requests, repository) {
  const target_repository = normalize_repository(repository)
  const closures = []
  const closure_by_issue = new Map()
  for (const pull_request of pull_requests) {
    const source_repository = pull_request_repository(pull_request, repository)
    const pull_request_number = Number(pull_request?.number)
    if (!source_repository || !Number.isSafeInteger(pull_request_number)) continue
    const source_pull_request = { repository: source_repository, pull_request_number }
    for (const reference of extract_close_references(pull_request?.body, repository)) {
      if (reference.repository !== target_repository) continue
      const key = `${reference.repository}#${reference.issue_number}`
      const existing_closure = closure_by_issue.get(key)
      if (existing_closure) {
        const already_cited = existing_closure.source_pull_requests.some(
          (source) => source.repository === source_repository && source.pull_request_number === pull_request_number
        )
        if (!already_cited) existing_closure.source_pull_requests.push(source_pull_request)
        continue
      }
      const closure = { ...reference, source_pull_requests: [source_pull_request] }
      closure_by_issue.set(key, closure)
      closures.push(closure)
    }
  }
  return closures
}

export function promotion_comment(promotion_sha, source_pull_requests) {
  const source_references = source_pull_requests.map(
    ({ repository, pull_request_number }) => `${repository}#${pull_request_number}`
  )
  const source_label = source_references.length === 1 ? 'source PR' : 'source PRs'
  return (
    `Closed by promotion \`${promotion_sha}\` to \`master\`; closing keyword found in ${source_label} ${source_references.join(', ')}.` +
    `\n\n<!-- aresrpg-close-leg:${promotion_sha} -->`
  )
}

const response_message = async (response) => {
  const response_text = await response.text()
  if (!response_text) return ''
  try {
    const response_json = JSON.parse(response_text)
    return response_json?.message ?? response_text
  } catch {
    return response_text
  }
}

const github_json = async ({ fetch_fn, api_url, token, endpoint, method = 'GET', body }) => {
  const response = await fetch_fn(`${api_url.replace(/\/$/, '')}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const message = await response_message(response)
    throw new Error(`GitHub API ${method} ${endpoint} failed (${response.status}): ${message}`)
  }
  if (response.status === 204) return null
  return response.json()
}

const fetch_promoted_commits = async (context) => {
  const { before_sha, promotion_sha, repository } = context
  const base_path = repository_path(repository)
  const commits = []
  let page = 1
  let total_commits = null
  while (true) {
    const comparison = await github_json({
      ...context,
      endpoint: `${base_path}/compare/${encodeURIComponent(before_sha)}...${encodeURIComponent(promotion_sha)}?per_page=${PAGE_SIZE}&page=${page}`,
    })
    if (page === 1) {
      if (comparison?.status === 'identical') return []
      if (comparison?.status !== 'ahead')
        throw new Error(
          `promotion range is not a fast-forward: ${before_sha}...${promotion_sha} (${comparison?.status ?? 'unknown'})`
        )
      total_commits = Number(comparison.total_commits)
      if (!Number.isSafeInteger(total_commits) || total_commits < 1)
        throw new Error(`invalid total_commits for promotion range: ${comparison?.total_commits}`)
    }
    const page_commits = Array.isArray(comparison?.commits) ? comparison.commits : []
    commits.push(...page_commits)
    if (commits.length === total_commits) {
      if (commits.at(-1)?.sha !== promotion_sha) throw new Error(`promotion range does not end at ${promotion_sha}`)
      return commits
    }
    if (commits.length > total_commits || page_commits.length < PAGE_SIZE)
      throw new Error(`truncated promotion range: expected ${total_commits} commit(s), received ${commits.length}`)
    page += 1
  }
}

const fetch_paginated_array = async (context, endpoint) => {
  const values = []
  let page = 1
  while (true) {
    const page_values = await github_json({
      ...context,
      endpoint: `${endpoint}?per_page=${PAGE_SIZE}&page=${page}`,
    })
    if (!Array.isArray(page_values)) throw new Error(`invalid paginated response for ${endpoint}`)
    values.push(...page_values)
    if (page_values.length < PAGE_SIZE) return values
    page += 1
  }
}

const fetch_associated_pull_requests = async (context, sha) => {
  const base_path = repository_path(context.repository)
  return fetch_paginated_array(context, `${base_path}/commits/${encodeURIComponent(sha)}/pulls`)
}

const fetch_pull_requests_by_sha = async (context, commits) => {
  const entries = []
  for (let index = 0; index < commits.length; index += ASSOCIATION_BATCH_SIZE) {
    const batch = commits.slice(index, index + ASSOCIATION_BATCH_SIZE)
    const batch_entries = await Promise.all(
      batch.map(async ({ sha }) => [sha, await fetch_associated_pull_requests(context, sha)])
    )
    entries.push(...batch_entries)
  }
  return Object.fromEntries(entries)
}

const close_issue = async (context, closure) => {
  const base_path = repository_path(closure.repository)
  const issue_path = `${base_path}/issues/${closure.issue_number}`
  const issue = await github_json({ ...context, endpoint: issue_path })
  if (issue?.state !== 'open' || issue?.pull_request) return false
  const comment = promotion_comment(context.promotion_sha, closure.source_pull_requests)
  const marker = `<!-- aresrpg-close-leg:${context.promotion_sha} -->`
  const existing_comments = await fetch_paginated_array(context, `${issue_path}/comments`)
  if (!existing_comments.some(({ body }) => typeof body === 'string' && body.includes(marker)))
    await github_json({
      ...context,
      endpoint: `${issue_path}/comments`,
      method: 'POST',
      body: { body: comment },
    })
  await github_json({
    ...context,
    endpoint: issue_path,
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' },
  })
  return true
}

/**
 * Effectful boundary. All GitHub reads/writes use fetch_fn, allowing unit tests to inject a complete
 * fake. An absent promotion SHA (or an empty range) is the deliberate non-promotion no-op.
 */
export async function close_promoted_issues({
  before_sha = '',
  promotion_sha = '',
  repository = '',
  token = '',
  fetch_fn = globalThis.fetch,
  api_url = 'https://api.github.com',
} = {}) {
  if (!promotion_sha || before_sha === promotion_sha) return empty_result()
  if (!before_sha) throw new Error('PROMOTED_BEFORE_SHA is required for a promotion')
  if (!normalize_repository(repository)) throw new Error('GITHUB_REPOSITORY is required for a promotion')
  if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required for a promotion')
  if (typeof fetch_fn !== 'function') throw new Error('fetch is unavailable')

  const context = { before_sha, promotion_sha, repository, token, fetch_fn, api_url }
  const commits = await fetch_promoted_commits(context)
  const pull_requests_by_sha = await fetch_pull_requests_by_sha(context, commits)
  const pull_requests = walk_promoted_range(commits, pull_requests_by_sha)
  const closures = plan_issue_closures(pull_requests, repository)
  let closed_issue_count = 0
  for (const closure of closures) {
    if (await close_issue(context, closure)) closed_issue_count += 1
  }
  return {
    commit_count: commits.length,
    pull_request_count: pull_requests.length,
    referenced_issue_count: closures.length,
    closed_issue_count,
  }
}

const main = async () => {
  const result = await close_promoted_issues({
    before_sha: process.env.PROMOTED_BEFORE_SHA ?? '',
    promotion_sha: process.env.PROMOTED_SHA ?? '',
    repository: process.env.GITHUB_REPOSITORY ?? '',
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '',
    fetch_fn: globalThis.fetch,
    api_url: process.env.GITHUB_API_URL ?? 'https://api.github.com',
  })
  console.log(
    `close leg: ${result.commit_count} commit(s), ${result.pull_request_count} source PR(s), ` +
      `${result.referenced_issue_count} referenced issue(s), ${result.closed_issue_count} closed`
  )
}

const script_path = file_url_to_path(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === script_path) {
  main().catch((error) => {
    console.error(`close leg failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
