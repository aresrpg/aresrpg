#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE BOARD DRAINS ITSELF — the close chain, rebuilt mechanically.
//
// ROOT CAUSE (#845): every landing in this repo is a FAST-FORWARD PUSH into `edge` (CLAUDE.md's
// workflow section). GitHub honours a `Fixes #N` close-keyword only when a pull request is MERGED
// into the repository's DEFAULT branch — an ff-push is neither, so the native close chain is INERT
// here and a fixed row outlives its fix. Board hygiene has been a hand pass ever since. These four
// passes are that chain, made mechanical:
//
//   landing  — PRIMARY, event-driven. On every push to edge, the pushed commits and their pull
//              requests are read for close-keyword refs; each still-open row is closed citing the
//              landing PR and commit. The board drains as work lands, not on a calendar.
//   backstop — the daily schedule replays the same sweep over PRs merged into edge inside the
//              --since-days window, so a missed, failed, or raced push run self-heals.
//   ref-gate — a `fix:`/`feat:` PR carrying ZERO issue refs gets ONE warning comment: the close
//              chain has nothing to close. Warning only, never a merge blocker.
//   stale    — the background backstop for rows nobody ever picked up. 7 days without human
//              activity earns `stale-warning`; 7 more earn a not-planned close.
//
// WHAT COUNTS AS ACTIVITY (the stale clock, and the one subtle part of this file): an issue's
// `updated_at` is a cheap PRE-FILTER and nothing more. It is bumped by this workflow's own comments
// and labels — which would reset the clock forever and make the ladder unable to ever reach its
// second rung — and it is not reliably bumped by a pull-request cross-reference. The real reading is
// the issue TIMELINE: the newest event among commented / cross-referenced / referenced / labeled /
// unlabeled / assigned / unassigned / renamed / milestoned / demilestoned / reopened / connected /
// disconnected / marked_as_duplicate, EXCLUDING every event actored by github-actions[bot].
// Subscriptions and mentions are noise and count for nothing. A row with no qualifying event falls
// back to its own creation date, so a brand-new issue is never stale.
//
// Board text — issue bodies, PR titles, commit messages — is UNTRUSTED DATA. It is scanned for issue
// numbers, bounded, and placed in JSON request bodies. It is never executed, never shell-interpolated,
// and never allowed to manufacture the HTML-comment markers this file uses as its idempotency protocol.
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const READ_DELAY_MS = 90
const MUTATION_DELAY_MS = 400
const MAX_RETRIES = 3
const MAX_PAGES = 30
const DAY_MS = 86_400_000

export const BOT_LOGIN = 'github-actions[bot]'
export const STALE_WARNING_LABEL = 'stale-warning'
export const WARN_AFTER_DAYS = 7
export const CLOSE_AFTER_WARNING_DAYS = 7
// EXEMPT BY LABEL, never by number. Measured 2026-07-27 against the live board: no `loop:*` label
// marks a standing row — those labels record PROVENANCE (which scheduled pass filed the row), and
// every loop-labelled open issue today is either an ordinary finding or a numbered pass ledger, both
// of which are work rows like any other. `epic` already exempts the standing family parents. When a
// genuinely standing ledger earns its own label, it joins this array — one line, reviewed.
// Deferral labels (`blocked`, `icebox`, `roadmap`, `mainnet`, `deferred-post-release`) are
// deliberately absent: deferred is not immortal.
export const EXEMPT_LABELS = ['P0', 'P1', 'security', 'owner-gated', 'epic']
// Secondary rate limits punish a 200-mutation burst, and a wall of 200 comments is noise nobody
// reads. Each pass spends at most this many mutations per run, oldest row first — the queue drains
// over consecutive days instead of detonating once.
export const MAX_ACTIONS_PER_RUN = 25

const ACTIVITY_EVENTS = new Set([
  'commented',
  'cross-referenced',
  'referenced',
  'labeled',
  'unlabeled',
  'assigned',
  'unassigned',
  'renamed',
  'milestoned',
  'demilestoned',
  'reopened',
  'connected',
  'disconnected',
  'marked_as_duplicate',
  'unmarked_as_duplicate',
])

const wait = (delay_ms) => new Promise((resolve) => setTimeout(resolve, delay_ms))
const is_record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---------------------------------------------------------------------------
// Pure core — every decision this file makes is one of the functions below.
// ---------------------------------------------------------------------------

// GitHub's own close-keyword grammar: close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved,
// optionally `owner/repo`-qualified. A bare `#12` is a MENTION, not a close instruction, and is
// deliberately not matched here — see mentions_issue for the ref-gate's looser reading.
const CLOSE_REF_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi

export function parse_close_refs(text, repository) {
  const owned = String(repository ?? '').toLowerCase()
  const numbers = [...String(text ?? '').matchAll(CLOSE_REF_RE)]
    .filter(([, repo]) => !repo || repo.toLowerCase() === owned)
    .map(([, , number]) => Number(number))
    .filter((number) => Number.isSafeInteger(number) && number > 0)
  return [...new Set(numbers)].toSorted((left, right) => left - right)
}

// The ref-gate asks the looser question ("did this PR reference ANY row?") on purpose: it warns about
// a BROKEN CLOSE CHAIN, and a deliberate `Refs #123` is a contributor who already thought about the
// board. Warning on that would be noise, and a noisy warning is an ignored warning.
export const mentions_issue = (text) => /#\d+\b/.test(String(text ?? ''))

export const is_fix_or_feat = (title) => /^(?:fix|feat)(?:\([^)]*\))?!?:\s/i.test(String(title ?? '').trim())

export const landing_marker = (evidence) =>
  evidence?.pr_number
    ? `<!-- board_hygiene landed pr=${Number(evidence.pr_number)} -->`
    : `<!-- board_hygiene landed sha=${String(evidence?.sha ?? '').replace(/[^0-9a-f]/gi, '')} -->`

export const STALE_WARNING_MARKER = '<!-- board_hygiene stale_warning -->'
export const REF_GATE_MARKER = '<!-- board_hygiene ref_gate -->'

const has_marker = (body, marker) =>
  String(body ?? '')
    .split(/\r?\n/)
    .includes(marker)

const from_bot = (item) => (item?.actor?.login ?? item?.user?.login) === BOT_LOGIN

// A landing sweep must never fight a human. If this pass already closed the row for THIS landing and
// somebody reopened it, that reopen was a deliberate act with evidence behind it — leave it alone.
export function decide_landing(issue, comments, evidence) {
  if (issue?.state !== 'open') return { action: 'noop', reason: 'already closed' }
  const marker = landing_marker(evidence)
  const swept = (comments ?? []).some((comment) => from_bot(comment) && has_marker(comment?.body, marker))
  if (swept) return { action: 'noop', reason: 'already swept for this landing (reopened deliberately)' }
  return { action: 'close' }
}

export function last_human_activity(timeline, created_at) {
  const stamps = (timeline ?? [])
    .filter((event) => ACTIVITY_EVENTS.has(event?.event) && !from_bot(event))
    .map((event) => Date.parse(event?.created_at ?? ''))
    .filter((stamp) => Number.isFinite(stamp))
  const created = Date.parse(created_at ?? '')
  return Math.max(...stamps, Number.isFinite(created) ? created : 0)
}

const warned_at = (timeline) => {
  const stamps = (timeline ?? [])
    .filter((event) => event?.event === 'labeled' && event?.label?.name === STALE_WARNING_LABEL && from_bot(event))
    .map((event) => Date.parse(event?.created_at ?? ''))
    .filter((stamp) => Number.isFinite(stamp))
  return stamps.length > 0 ? Math.max(...stamps) : null
}

export function decide_stale(issue, timeline, now_ms) {
  const labels = (issue?.labels ?? []).map((label) => label?.name ?? label)
  const exempt = EXEMPT_LABELS.find((name) => labels.includes(name))
  if (exempt) return { action: 'exempt', label: exempt }

  const last_activity = last_human_activity(timeline, issue?.created_at)
  if (!labels.includes(STALE_WARNING_LABEL))
    return now_ms - last_activity >= WARN_AFTER_DAYS * DAY_MS
      ? { action: 'warn', last_activity }
      : { action: 'noop', last_activity }

  const warned = warned_at(timeline)
  // The label exists but this workflow never applied it: a human put it there, so this pass owns no
  // grace period it can prove. Say so instead of closing on an unmeasured clock.
  if (warned === null) return { action: 'noop', last_activity, reason: 'stale-warning applied outside this workflow' }
  // Activity after the warning removes the warning — mechanically, no human required.
  if (last_activity > warned) return { action: 'unwarn', last_activity }
  return now_ms - warned >= CLOSE_AFTER_WARNING_DAYS * DAY_MS
    ? { action: 'close', last_activity, warned }
    : { action: 'noop', last_activity, warned }
}

export function decide_ref_gate(pull_request, commits, comments) {
  if (!is_fix_or_feat(pull_request?.title)) return { action: 'noop', reason: 'not a fix:/feat: pull request' }
  const referenced =
    mentions_issue(pull_request?.body) ||
    mentions_issue(pull_request?.title) ||
    (commits ?? []).some((commit) => mentions_issue(commit?.commit?.message))
  const existing = (comments ?? []).find((comment) => from_bot(comment) && has_marker(comment?.body, REF_GATE_MARKER))
  if (!referenced) return existing ? { action: 'noop', reason: 'already warned' } : { action: 'warn' }
  return existing ? { action: 'resolve', comment_id: Number(existing.id) } : { action: 'noop', reason: 'referenced' }
}

// ---------------------------------------------------------------------------
// Comment bodies — one home per sentence the board will read.
// ---------------------------------------------------------------------------

export const landing_comment = (evidence) =>
  [
    evidence.pr_number
      ? `Closed by #${Number(evidence.pr_number)} (landed \`${evidence.sha.slice(0, 12)}\` on \`edge\`).`
      : `Closed by commit \`${evidence.sha.slice(0, 12)}\` (landed on \`edge\`).`,
    '',
    "This repo lands by fast-forward push, where GitHub's own close-keywords are inert (#845) — so this",
    'is the mechanical sweep that closes the row instead. Reopen with evidence if it is still real.',
    '',
    landing_marker(evidence),
  ].join('\n')

export const stale_warning_comment = () =>
  [
    `No activity for ${WARN_AFTER_DAYS} days — this row auto-closes in ${CLOSE_AFTER_WARNING_DAYS} more unless it moves.`,
    '',
    'A comment, a label change, an assignment, or a pull request that references it all reset the clock',
    'mechanically. Reopen with evidence if it is still real.',
    '',
    STALE_WARNING_MARKER,
  ].join('\n')

export const stale_close_comment = () =>
  [
    `Closed as not planned: ${WARN_AFTER_DAYS + CLOSE_AFTER_WARNING_DAYS} days without activity, ${CLOSE_AFTER_WARNING_DAYS} of them after the staleness warning.`,
    '',
    'Nothing is lost — reopen with evidence and it rides again. Deferred is not immortal.',
    '',
    '<!-- board_hygiene stale_closed -->',
  ].join('\n')

export const ref_gate_comment = () =>
  [
    '**No issue ref.** This `fix:`/`feat:` pull request references no row, so the close chain is broken:',
    'nothing on the board drains when it lands.',
    '',
    'Add `Fixes #N` (or `Closes #N`) to the body. This repo lands by fast-forward push, where GitHub’s own',
    'close-keywords never fire (#845) — `.github/workflows/board-hygiene.yml` is what actually closes the',
    'row, and it reads exactly those keywords.',
    '',
    'This is a warning, not a gate: it never blocks a merge.',
    '',
    REF_GATE_MARKER,
  ].join('\n')

export const ref_gate_resolved_comment = (refs) =>
  [
    `Resolved — this pull request now references ${refs.length > 0 ? refs.map((n) => `#${n}`).join(', ') : 'a board row'}.`,
    '',
    REF_GATE_MARKER,
  ].join('\n')

// ---------------------------------------------------------------------------
// Effects — the GitHub edge.
// ---------------------------------------------------------------------------

const is_retryable = (response) => response.status === 429 || response.status >= 500

async function request_json(url, { config, method = 'GET', body, delay_ms, attempt = 0 }) {
  await config.sleep(delay_ms)
  const response = await config.fetch_fn(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.github_token}`,
      'User-Agent': 'aresrpg-board-hygiene',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  // Only GETs are replayed. A failed mutation is ambiguous — GitHub may have applied it before the
  // 5xx — and every mutation here is marker-guarded, so the next run reconciles it without ever
  // double-commenting.
  if (method === 'GET' && is_retryable(response) && attempt + 1 < MAX_RETRIES) {
    await config.sleep(Math.min(1000 * 2 ** attempt, 15_000))
    return request_json(url, { config, method, body, delay_ms: 0, attempt: attempt + 1 })
  }
  if (!response.ok) {
    const detail = String(await response.text())
      .replace(/\s+/g, ' ')
      .slice(0, 300)
    throw new Error(`github API ${response.status} on ${method} ${new URL(url).pathname}: ${detail}`)
  }
  return { data: response.status === 204 ? null : await response.json(), link: response.headers.get('link') }
}

const next_link = (header) =>
  String(header ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => /rel="next"/.test(entry))
    ?.match(/^<([^>]+)>/)?.[1] ?? null

const assert_api_origin = (url) => {
  const parsed = new URL(url)
  if (parsed.origin !== GITHUB_API_ORIGIN) throw new Error(`refusing pagination outside ${GITHUB_API_ORIGIN}`)
  return parsed.href
}

// `stop` ends pagination at the first page containing a row past the caller's horizon — a descending
// listing has nothing useful after it, and walking every closed pull request in repo history to find
// the last fortnight's is how this pass first timed out.
async function collect_pages(config, url, stop = null, collected = [], page_count = 0) {
  if (page_count >= MAX_PAGES) throw new Error(`pagination exceeded ${MAX_PAGES} pages`)
  const { data, link } = await request_json(assert_api_origin(url), { config, delay_ms: READ_DELAY_MS })
  if (!Array.isArray(data)) throw new Error('paginated API response must be an array')
  const all = [...collected, ...data]
  const next = next_link(link)
  return next && !(stop && data.some(stop)) ? collect_pages(config, next, stop, all, page_count + 1) : all
}

const api_url = (config, path_name, params = {}) => {
  const parts = String(config.repository).split('/')
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part)))
    throw new Error('GITHUB_REPOSITORY must be owner/name')
  const url = new URL(`/repos/${config.repository}${path_name}`, GITHUB_API_ORIGIN)
  url.search = new URLSearchParams(params).toString()
  return url.href
}

const get_json = async (config, path_name, params) => {
  const { data } = await request_json(api_url(config, path_name, params), { config, delay_ms: READ_DELAY_MS })
  return data
}

const mutate = async (config, method, path_name, body) => {
  if (config.dry_run) return null
  const { data } = await request_json(api_url(config, path_name), { config, method, body, delay_ms: MUTATION_DELAY_MS })
  return data
}

const list_comments = (config, issue_number) =>
  collect_pages(config, api_url(config, `/issues/${issue_number}/comments`, { per_page: '100' }))

const list_timeline = (config, issue_number) =>
  collect_pages(config, api_url(config, `/issues/${issue_number}/timeline`, { per_page: '100' }))

const post_comment = (config, issue_number, body) =>
  mutate(config, 'POST', `/issues/${issue_number}/comments`, { body })

const close_issue = (config, issue_number, state_reason) =>
  mutate(config, 'PATCH', `/issues/${issue_number}`, { state: 'closed', state_reason })

// GitHub returns 422 when the label already exists; that is this call's success case, not a failure.
async function ensure_stale_label(config) {
  if (config.dry_run) return
  const existing = await config.fetch_fn(api_url(config, `/labels/${STALE_WARNING_LABEL}`), {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.github_token}` },
  })
  if (existing.ok) return
  await mutate(config, 'POST', '/labels', {
    name: STALE_WARNING_LABEL,
    color: '795548',
    description: 'No activity for 7 days — auto-closes in 7 more unless it moves (board-hygiene.yml)',
  })
}

// ---------------------------------------------------------------------------
// Pass 1 + 2 — close on landing (push event), and its daily replay.
// ---------------------------------------------------------------------------

// One row can be referenced by several commits of one landing; the FIRST evidence wins so the comment
// cites the commit that actually carried the fix.
const merge_evidence = (found, number, evidence) => (found.has(number) ? found : new Map(found).set(number, evidence))

async function pushed_landings(config) {
  const compare = await get_json(config, `/compare/${config.base}...${config.head}`)
  const commits = Array.isArray(compare?.commits) ? compare.commits : []
  return commits.reduce(async (found_promise, commit) => {
    const found = await found_promise
    const sha = String(commit?.sha ?? '')
    const pulls = await get_json(config, `/commits/${sha}/pulls`)
    const pull = (Array.isArray(pulls) ? pulls : []).find((candidate) => candidate?.base?.ref === 'edge') ?? null
    const text = [commit?.commit?.message, pull?.title, pull?.body].filter(Boolean).join('\n')
    return parse_close_refs(text, config.repository).reduce(
      (accumulated, number) => merge_evidence(accumulated, number, { sha, pr_number: pull?.number ?? null }),
      found
    )
  }, Promise.resolve(new Map()))
}

async function merged_pull_landings(config) {
  const cutoff = config.now_ms - config.since_days * DAY_MS
  const pulls = await collect_pages(
    config,
    api_url(config, '/pulls', { state: 'closed', base: 'edge', sort: 'updated', direction: 'desc', per_page: '100' }),
    (pull) => Date.parse(pull?.updated_at ?? '') < cutoff
  )
  return pulls
    .filter((pull) => pull?.merged_at && Date.parse(pull.merged_at) >= cutoff)
    .reduce(
      (found, pull) =>
        parse_close_refs([pull?.title, pull?.body].filter(Boolean).join('\n'), config.repository).reduce(
          (accumulated, number) =>
            merge_evidence(accumulated, number, {
              sha: String(pull?.merge_commit_sha ?? ''),
              pr_number: Number(pull?.number),
            }),
          found
        ),
      new Map()
    )
}

async function sweep_landings(config, landings) {
  const rows = [...landings.entries()]
  return rows.reduce(
    async (summary_promise, [number, evidence]) => {
      const summary = await summary_promise
      const issue = await get_json(config, `/issues/${number}`)
      const comments = issue?.state === 'open' ? await list_comments(config, number) : []
      const decision = decide_landing(issue, comments, evidence)
      if (decision.action !== 'close') {
        config.log(`landing: #${number} skipped — ${decision.reason}`)
        return { ...summary, skipped: summary.skipped + 1 }
      }
      config.log(
        `landing: ${config.dry_run ? 'WOULD close' : 'closing'} #${number} — ${evidence.pr_number ? `#${evidence.pr_number}` : evidence.sha.slice(0, 12)}: ${String(issue?.title ?? '').slice(0, 90)}`
      )
      await post_comment(config, number, landing_comment(evidence))
      await close_issue(config, number, 'completed')
      return { ...summary, closed: summary.closed + 1 }
    },
    Promise.resolve({ closed: 0, skipped: 0 })
  )
}

export async function run_landing(config) {
  const landings = config.mode === 'landing' ? await pushed_landings(config) : await merged_pull_landings(config)
  config.log(`${config.mode}: ${landings.size} referenced row(s) found`)
  return sweep_landings(config, landings)
}

// ---------------------------------------------------------------------------
// Pass 3 — the stale backstop.
// ---------------------------------------------------------------------------

export async function run_stale(config) {
  const open_issues = (
    await collect_pages(
      config,
      api_url(config, '/issues', { state: 'open', sort: 'updated', direction: 'asc', per_page: '100' })
    )
  ).filter((issue) => !issue?.pull_request)

  // Pre-filter: an issue updated inside the warning window and NOT already warned cannot be stale, and
  // costs a timeline request to prove it. Warned rows always read their timeline — their `updated_at`
  // was bumped by this pass's own comment.
  const candidates = open_issues.filter((issue) => {
    const labels = (issue?.labels ?? []).map((label) => label?.name ?? label)
    if (labels.includes(STALE_WARNING_LABEL)) return true
    return config.now_ms - Date.parse(issue?.updated_at ?? '') >= WARN_AFTER_DAYS * DAY_MS
  })
  config.log(`stale: ${open_issues.length} open rows, ${candidates.length} past the ${WARN_AFTER_DAYS}-day pre-filter`)

  const decisions = await candidates.reduce(async (list_promise, issue) => {
    const list = await list_promise
    const labels = (issue?.labels ?? []).map((label) => label?.name ?? label)
    const exempt = EXEMPT_LABELS.find((name) => labels.includes(name))
    // Exempt rows never cost a timeline request — the label alone decides.
    if (exempt) return [...list, { issue, decision: { action: 'exempt', label: exempt } }]
    const timeline = await list_timeline(config, issue.number)
    return [...list, { issue, decision: decide_stale(issue, timeline, config.now_ms) }]
  }, Promise.resolve([]))

  const of_action = (action) =>
    decisions
      .filter((row) => row.decision.action === action)
      .toSorted((left, right) => left.decision.last_activity - right.decision.last_activity)

  const to_close = of_action('close').slice(0, MAX_ACTIONS_PER_RUN)
  const to_warn = of_action('warn').slice(0, MAX_ACTIONS_PER_RUN)
  const to_unwarn = of_action('unwarn')
  const age_days = (row) => Math.floor((config.now_ms - row.decision.last_activity) / DAY_MS)

  if (to_warn.length > 0 || to_close.length > 0) await ensure_stale_label(config)

  await to_unwarn.reduce(async (done, row) => {
    await done
    config.log(`stale: ${config.dry_run ? 'WOULD unwarn' : 'unwarning'} #${row.issue.number} — moved since the warning`)
    return mutate(config, 'DELETE', `/issues/${row.issue.number}/labels/${STALE_WARNING_LABEL}`)
  }, Promise.resolve())

  await to_warn.reduce(async (done, row) => {
    await done
    config.log(
      `stale: ${config.dry_run ? 'WOULD warn' : 'warning'} #${row.issue.number} (${age_days(row)}d): ${String(row.issue.title).slice(0, 90)}`
    )
    await post_comment(config, row.issue.number, stale_warning_comment())
    return mutate(config, 'POST', `/issues/${row.issue.number}/labels`, { labels: [STALE_WARNING_LABEL] })
  }, Promise.resolve())

  await to_close.reduce(async (done, row) => {
    await done
    config.log(
      `stale: ${config.dry_run ? 'WOULD close' : 'closing'} #${row.issue.number} (${age_days(row)}d): ${String(row.issue.title).slice(0, 90)}`
    )
    await post_comment(config, row.issue.number, stale_close_comment())
    return close_issue(config, row.issue.number, 'not_planned')
  }, Promise.resolve())

  return {
    scanned: open_issues.length,
    exempt: decisions.filter((row) => row.decision.action === 'exempt').length,
    warned: to_warn.length,
    warn_queued: of_action('warn').length - to_warn.length,
    closed: to_close.length,
    close_queued: of_action('close').length - to_close.length,
    unwarned: to_unwarn.length,
  }
}

// ---------------------------------------------------------------------------
// Pass 4 — the ref gate.
// ---------------------------------------------------------------------------

export async function run_ref_gate(config) {
  const pull_request = await get_json(config, `/pulls/${config.pull_number}`)
  const commits = await collect_pages(
    config,
    api_url(config, `/pulls/${config.pull_number}/commits`, { per_page: '100' })
  )
  const comments = await list_comments(config, config.pull_number)
  const decision = decide_ref_gate(pull_request, commits, comments)

  if (decision.action === 'warn') {
    config.log(`ref-gate: ${config.dry_run ? 'WOULD warn' : 'warning'} #${config.pull_number} — no issue ref`)
    await post_comment(config, config.pull_number, ref_gate_comment())
  } else if (decision.action === 'resolve') {
    const refs = parse_close_refs([pull_request?.title, pull_request?.body].join('\n'), config.repository)
    config.log(`ref-gate: resolving the warning on #${config.pull_number}`)
    await mutate(config, 'PATCH', `/issues/comments/${decision.comment_id}`, { body: ref_gate_resolved_comment(refs) })
  } else {
    config.log(`ref-gate: #${config.pull_number} clean — ${decision.reason}`)
  }
  return decision.action
}

// ---------------------------------------------------------------------------
// CLI edge.
// ---------------------------------------------------------------------------

const MODES = { landing: run_landing, backstop: run_landing, stale: run_stale, 'ref-gate': run_ref_gate }

const flag_value = (argv, name, fallback = null) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}

const required_env = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function parse_args(argv) {
  const [mode] = argv
  if (!Object.hasOwn(MODES, mode ?? ''))
    throw new Error(
      `usage: board_hygiene.mjs <${Object.keys(MODES).join('|')}> [--dry-run] [--base SHA --head SHA] [--pr N] [--since-days N]`
    )
  return {
    mode,
    dry_run: argv.includes('--dry-run'),
    base: flag_value(argv, 'base'),
    head: flag_value(argv, 'head'),
    pull_number: Number(flag_value(argv, 'pr', '0')),
    since_days: Number(flag_value(argv, 'since-days', '14')),
    as_of: flag_value(argv, 'as-of'),
  }
}

// `--as-of` moves the clock the stale ladder reads, so a dry run can answer "what does this do NEXT
// week" against the real board instead of only "what does it do this second". DRY RUN ONLY — a
// scheduled run must never be able to argue about what time it is.
export function resolve_now(args, wall_clock_ms) {
  if (!args.as_of) return wall_clock_ms
  if (!args.dry_run) throw new Error('--as-of is a dry-run projection flag; it cannot move a live run clock')
  const parsed = Date.parse(args.as_of)
  if (!Number.isFinite(parsed)) throw new Error(`--as-of must be an ISO date, got ${args.as_of}`)
  return parsed
}

async function main() {
  const args = parse_args(process.argv.slice(2))
  if (args.mode === 'landing' && !(args.base && args.head)) throw new Error('landing mode needs --base and --head')
  if (args.mode === 'ref-gate' && !Number.isSafeInteger(args.pull_number)) throw new Error('ref-gate mode needs --pr')
  const config = {
    ...args,
    github_token: required_env('GITHUB_TOKEN'),
    repository: required_env('GITHUB_REPOSITORY'),
    now_ms: resolve_now(args, Date.now()),
    fetch_fn: fetch,
    sleep: wait,
    log: (message) => console.log(message),
  }
  if (config.dry_run)
    console.log(
      `board hygiene: DRY RUN (${config.mode}) — no mutation will be sent, clock reads ${new Date(config.now_ms).toISOString()}`
    )
  const summary = await MODES[config.mode](config)
  console.log(`board hygiene ${config.mode} complete: ${JSON.stringify(is_record(summary) ? summary : { summary })}`)
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main) {
  main().catch((error) => {
    console.error('board hygiene failed', error)
    process.exitCode = 1
  })
}
