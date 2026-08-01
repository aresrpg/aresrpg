#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hourly Sentry -> GitHub triage loop. Remote issue/event text is untrusted data:
// this script only bounds it and places it in JSON request bodies; it never
// executes it. Effects stay in the API edge; dedupe/update decisions are pure.
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const SENTRY_API_ORIGIN = 'https://de.sentry.io'
const GITHUB_API_ORIGIN = 'https://api.github.com'
const SENTRY_REQUEST_DELAY_MS = 250
const GITHUB_REQUEST_DELAY_MS = 250
const GITHUB_SEARCH_DELAY_MS = 2100
const MAX_RETRIES = 3
const MAX_PAGES = 50
const MAX_RATE_LIMIT_WAIT_MS = 60_000
const GITHUB_ACTIONS_BOT_LOGIN = 'github-actions[bot]'
// Useful at low volume and proportional at high volume: max(5 events, 25%).
const MATERIAL_GROWTH_FLOOR = 5
const MATERIAL_GROWTH_RATIO = 0.25

const wait = (delay_ms) => new Promise((resolve) => setTimeout(resolve, delay_ms))
const is_record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const clean_inline = (value, limit = 500) =>
  String(value ?? '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Sentry fields are untrusted. Keep them from manufacturing the HTML
    // comments used as the GitHub idempotency protocol.
    .replaceAll('<!--', '&lt;!--')
    .replaceAll('-->', '--&gt;')
    .slice(0, limit)
const inline_code = (value) => clean_inline(value).replaceAll('`', "'")

const sentry_id = (issue) => {
  const id = String(issue?.id ?? '')
  if (!/^\d+$/.test(id)) throw new Error('Sentry issue id must be numeric')
  return id
}

const event_count = (issue) => {
  const count = Number(issue?.count)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid Sentry event count for ${sentry_id(issue)}`)
  return count
}

const issue_link = (issue) => {
  const link = new URL(String(issue?.permalink ?? ''))
  const is_sentry_host = link.hostname === 'sentry.io' || link.hostname.endsWith('.sentry.io')
  if (link.protocol !== 'https:' || !is_sentry_host) throw new Error(`invalid Sentry link for ${sentry_id(issue)}`)
  return link.href
}

export const sentry_issue_marker = (id) => `<!-- sentry_issue_id=${String(id)} -->`
export const sentry_count_marker = (count) => `<!-- sentry_reported_count=${Number(count)} -->`

export function materially_grew(previous_count, current_count) {
  if (![previous_count, current_count].every((count) => Number.isSafeInteger(count) && count >= 0)) return false
  const required_growth = Math.max(MATERIAL_GROWTH_FLOOR, Math.ceil(previous_count * MATERIAL_GROWTH_RATIO))
  return current_count - previous_count >= required_growth
}

const marker_lines = (text) => String(text ?? '').split(/\r?\n/)
const is_triage_actor = (item) => item?.user?.login === GITHUB_ACTIONS_BOT_LOGIN
const has_issue_marker = (text, id) => marker_lines(text).includes(sentry_issue_marker(id))
const reported_counts = (text, id) =>
  marker_lines(text).flatMap((line, index, lines) => {
    if (line !== sentry_issue_marker(id)) return []
    const match = /^<!-- sentry_reported_count=(\d+) -->$/.exec(lines[index + 1] ?? '')
    if (!match) return []
    const count = Number(match[1])
    return Number.isSafeInteger(count) ? [count] : []
  })

const select_existing_issue = (id, github_issues) =>
  github_issues
    .filter((issue) => is_triage_actor(issue) && has_issue_marker(issue?.body, id))
    .toSorted((left, right) => Number(left.number) - Number(right.number))[0] ?? null

const latest_reported_count = (id, github_issue, comments) => {
  const trusted_comments = comments.filter(is_triage_actor)
  const counts = [github_issue?.body, ...trusted_comments.map((comment) => comment?.body)].flatMap((body) =>
    reported_counts(body, id)
  )
  return counts.length > 0 ? Math.max(...counts) : 0
}

export function decide_triage(issue, github_issues, comments) {
  const existing_issue = select_existing_issue(sentry_id(issue), github_issues)
  if (!existing_issue) return { action: 'create' }
  const issue_number = Number(existing_issue.number)
  if (!Number.isSafeInteger(issue_number) || issue_number <= 0) throw new Error('invalid GitHub issue number')
  const reported_count = latest_reported_count(sentry_id(issue), existing_issue, comments)
  if (!materially_grew(reported_count, event_count(issue))) return { action: 'noop', issue_number, reported_count }
  return { action: 'comment', issue_number, previous_count: reported_count }
}

export function fingerprint_from_event(event) {
  const raw = event?.fingerprints ?? event?.fingerprint ?? []
  const values = (Array.isArray(raw) ? raw : [raw]).map((value) => clean_inline(value)).filter(Boolean)
  return values.length > 0 ? values : ['{{ default }}']
}

export function build_github_issue(issue, fingerprint) {
  const error_type = clean_inline(issue?.metadata?.type ?? issue?.title ?? 'Sentry error', 100) || 'Sentry error'
  const culprit =
    clean_inline(issue?.culprit ?? issue?.metadata?.function ?? 'unknown culprit', 140) || 'unknown culprit'
  const count = event_count(issue)
  const id = sentry_id(issue)
  const body = [
    '## Sentry issue',
    '',
    `- Fingerprint: \`${inline_code(fingerprint.join(' | '))}\``,
    `- Event count: ${count}`,
    `- First seen: ${clean_inline(issue?.firstSeen) || 'unknown'}`,
    `- Last seen: ${clean_inline(issue?.lastSeen) || 'unknown'}`,
    `- Sentry: ${issue_link(issue)}`,
    '',
    sentry_issue_marker(id),
    sentry_count_marker(count),
  ].join('\n')
  return { title: `${error_type}: ${culprit}`.slice(0, 256), body }
}

export function build_update_comment(issue, previous_count) {
  const count = event_count(issue)
  const id = sentry_id(issue)
  return {
    body: [
      `Sentry event count materially increased: **${previous_count} → ${count}**.`,
      '',
      `- Last seen: ${clean_inline(issue?.lastSeen) || 'unknown'}`,
      `- Sentry: ${issue_link(issue)}`,
      '',
      sentry_issue_marker(id),
      sentry_count_marker(count),
    ].join('\n'),
  }
}

const rate_limit_delay = (response, attempt) => {
  const accept_server_delay = (delay_ms) => {
    if (delay_ms > MAX_RATE_LIMIT_WAIT_MS)
      throw new Error(`server requested ${Math.ceil(delay_ms)}ms rate-limit wait; deferring to the next run`)
    return delay_ms
  }
  const retry_after_header = response.headers.get('retry-after')
  if (retry_after_header !== null && retry_after_header.trim() !== '') {
    const retry_after = Number(retry_after_header)
    if (Number.isFinite(retry_after) && retry_after >= 0) return accept_server_delay(retry_after * 1000)
  }
  const reset_header = response.headers.get('x-ratelimit-reset')
  if (reset_header !== null && reset_header.trim() !== '') {
    const reset_at = Number(reset_header) * 1000
    if (Number.isFinite(reset_at) && reset_at > Date.now()) return accept_server_delay(reset_at - Date.now() + 1000)
  }
  return Math.min(1000 * 2 ** attempt, MAX_RATE_LIMIT_WAIT_MS)
}

const is_retryable = (response) =>
  response.status === 429 ||
  response.status >= 500 ||
  (response.status === 403 &&
    (response.headers.get('x-ratelimit-remaining') === '0' || Boolean(response.headers.get('retry-after')?.trim())))

async function request_json(
  url,
  { token, provider, method = 'GET', body, delay_ms, fetch_fn = fetch, sleep = wait, attempt = 0 }
) {
  await sleep(delay_ms)
  const response = await fetch_fn(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'aresrpg-sentry-triage',
      ...(provider === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  // A failed POST response is ambiguous: GitHub may have accepted the issue or
  // comment before returning a 5xx/429. Let the next hourly marker search
  // reconcile it instead of replaying a mutation and creating a duplicate.
  if (method === 'GET' && is_retryable(response) && attempt + 1 < MAX_RETRIES) {
    await sleep(rate_limit_delay(response, attempt))
    return request_json(url, {
      token,
      provider,
      method,
      body,
      delay_ms: 0,
      fetch_fn,
      sleep,
      attempt: attempt + 1,
    })
  }
  if (!response.ok) {
    const detail = clean_inline(await response.text(), 300)
    throw new Error(`${provider} API ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return {
    data: response.status === 204 ? null : await response.json(),
    link: response.headers.get('link'),
  }
}

const next_link = (header) =>
  String(header ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => /rel="next"/.test(entry) && !/results="false"/.test(entry))
    ?.match(/^<([^>]+)>/)?.[1] ?? null

const assert_api_origin = (url, origin) => {
  const parsed = new URL(url)
  if (parsed.origin !== origin) throw new Error(`refusing pagination outside ${origin}`)
  return parsed.href
}

async function collect_pages(url, request, origin, collected = [], page_count = 0) {
  if (page_count >= MAX_PAGES) throw new Error(`pagination exceeded ${MAX_PAGES} pages`)
  const { data, link } = await request(assert_api_origin(url, origin))
  if (!Array.isArray(data)) throw new Error('paginated API response must be an array')
  const next = next_link(link)
  return next ? collect_pages(next, request, origin, [...collected, ...data], page_count + 1) : [...collected, ...data]
}

const validate_slug = (name, value) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`${name} must be a slug`)
  return value
}

const validate_repository = (repository) => {
  const parts = repository.split('/')
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part)))
    throw new Error('GITHUB_REPOSITORY must be owner/name')
  return repository
}

const sentry_request = (config, url) =>
  request_json(url, {
    token: config.sentry_auth_token,
    provider: 'sentry',
    delay_ms: SENTRY_REQUEST_DELAY_MS,
    fetch_fn: config.fetch_fn,
    sleep: config.sleep,
  })

const github_request = (config, url, options = {}) =>
  request_json(url, {
    token: config.github_token,
    provider: 'github',
    delay_ms: options.delay_ms ?? GITHUB_REQUEST_DELAY_MS,
    method: options.method,
    body: options.body,
    fetch_fn: config.fetch_fn,
    sleep: config.sleep,
  })

async function list_sentry_issues(config) {
  const organization = validate_slug('SENTRY_ORG', config.sentry_org)
  const project = validate_slug('SENTRY_PROJECT', config.sentry_project)
  const url = new URL(`/api/0/projects/${organization}/${project}/issues/`, SENTRY_API_ORIGIN)
  url.search = new URLSearchParams({ query: 'is:unresolved', sort: 'date', per_page: '100' }).toString()
  return collect_pages(url.href, (page_url) => sentry_request(config, page_url), SENTRY_API_ORIGIN)
}

async function latest_sentry_event(config, id) {
  const url = new URL(`/api/0/issues/${sentry_id({ id })}/events/latest/`, SENTRY_API_ORIGIN)
  const { data } = await sentry_request(config, url.href)
  if (!is_record(data)) throw new Error(`latest Sentry event ${id} is not an object`)
  return data
}

async function search_github_issues(config, id) {
  const repository = validate_repository(config.github_repository)
  const url = new URL('/search/issues', GITHUB_API_ORIGIN)
  url.search = new URLSearchParams({
    q: `repo:${repository} is:issue in:body "sentry_issue_id=${id}"`,
    per_page: '100',
  }).toString()
  const { data } = await github_request(config, url.href, { delay_ms: GITHUB_SEARCH_DELAY_MS })
  const total_count = Number(data?.total_count)
  if (
    !is_record(data) ||
    !Array.isArray(data.items) ||
    data.incomplete_results === true ||
    !Number.isSafeInteger(total_count) ||
    total_count < 0 ||
    total_count !== data.items.length
  )
    throw new Error(`incomplete GitHub issue search for Sentry ${id}`)
  return data.items
}

async function list_github_comments(config, issue_number) {
  const repository = validate_repository(config.github_repository)
  const url = new URL(`/repos/${repository}/issues/${issue_number}/comments`, GITHUB_API_ORIGIN)
  url.search = new URLSearchParams({ per_page: '100' }).toString()
  return collect_pages(url.href, (page_url) => github_request(config, page_url), GITHUB_API_ORIGIN)
}

const post_github = async (config, path_name, body) => {
  const repository = validate_repository(config.github_repository)
  const url = new URL(`/repos/${repository}${path_name}`, GITHUB_API_ORIGIN)
  return github_request(config, url.href, { method: 'POST', body })
}

async function triage_one(config, issue) {
  const id = sentry_id(issue)
  const github_issues = await search_github_issues(config, id)
  const existing_issue = select_existing_issue(id, github_issues)
  const comments = existing_issue ? await list_github_comments(config, Number(existing_issue.number)) : []
  const decision = decide_triage(issue, github_issues, comments)

  if (decision.action === 'create') {
    const latest_event = await latest_sentry_event(config, id)
    await post_github(config, '/issues', build_github_issue(issue, fingerprint_from_event(latest_event)))
    config.log(`sentry triage: created GitHub issue for Sentry ${id}`)
  } else if (decision.action === 'comment') {
    await post_github(
      config,
      `/issues/${decision.issue_number}/comments`,
      build_update_comment(issue, decision.previous_count)
    )
    config.log(`sentry triage: updated GitHub issue #${decision.issue_number} for Sentry ${id}`)
  } else {
    config.log(`sentry triage: no material growth for Sentry ${id}`)
  }
  return decision.action
}

export async function run_triage(config) {
  const issues = (await list_sentry_issues(config)).filter((issue) => issue?.status === 'unresolved')
  return issues.reduce(
    async (summary_promise, issue) => {
      const summary = await summary_promise
      const action = await triage_one(config, issue)
      return { ...summary, [action]: summary[action] + 1 }
    },
    Promise.resolve({ create: 0, comment: 0, noop: 0 })
  )
}

const required_env = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const summary = await run_triage({
    sentry_auth_token: required_env('SENTRY_AUTH_TOKEN'),
    sentry_org: required_env('SENTRY_ORG'),
    sentry_project: required_env('SENTRY_PROJECT'),
    github_token: required_env('GITHUB_TOKEN'),
    github_repository: required_env('GITHUB_REPOSITORY'),
    fetch_fn: fetch,
    sleep: wait,
    log: (message) => console.log(message),
  })
  console.log(
    `sentry triage complete: created=${summary.create} commented=${summary.comment} unchanged=${summary.noop}`
  )
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main) {
  main().catch((error) => {
    console.error('sentry triage failed', error)
    process.exitCode = 1
  })
}
