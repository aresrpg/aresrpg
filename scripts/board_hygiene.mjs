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
//   link-gate— the BLOCKING half: a pull request into edge must carry a close-keyword the landing
//              pass will actually read, or the `no-issue` label saying it deliberately closes no row.
//              It asserts the same refs, over the same sources, through the same parser the landing
//              pass uses — so a green gate MEANS the board drains on landing, rather than hoping it.
//   ref-gate — warns once when a conventional PR has no issue refs; never a merge blocker.
//   stale    — the background backstop for rows nobody ever picked up. 7 days without human
//              activity earns `stale-warning`; 7 more earn a not-planned close.
//
// WHY A LABEL AND NOT AN API FIELD: `closingIssuesReferences` — GitHub's own registered-link field —
// is EMPTY for every pull request in this repository (measured 2026-07-29: 0 of 555, across every
// base branch), for the same root cause as above. Keywords are interpreted only on the default
// branch, so no link is ever created for a PR into `edge`, and no API or mutation can register one.
// The pull request's own text is the only linkage signal that exists here; this file is its parser.
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
import { execFile as exec_file } from 'node:child_process'
import { readFileSync as read_file_sync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'
import { promisify } from 'node:util'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const READ_DELAY_MS = 90
const MUTATION_DELAY_MS = 400
const MAX_RETRIES = 3
const MAX_PAGES = 30
const DAY_MS = 86_400_000
const ZERO_SHA = '0000000000000000000000000000000000000000'
const GH_API_MAX_BUFFER = 16 * 1024 * 1024

export const BOT_LOGIN = 'github-actions[bot]'
export const STALE_WARNING_LABEL = 'stale-warning'
// The one sanctioned way past the link gate: a pull request that deliberately closes no row (a
// live-diagnosed fix nobody filed, an instrument, a slice of a tracker that stays open) says so out
// loud with this label instead of inventing a row to point at.
export const NO_ISSUE_LABEL = 'no-issue'
export const WARN_AFTER_DAYS = 7
export const CLOSE_AFTER_WARNING_DAYS = 7
// EXEMPT BY LABEL, never by number. Measured 2026-07-27 against the live board: no `loop:*` label
// marks a standing row — those labels record PROVENANCE (which scheduled pass filed the row), and
// every loop-labelled open issue today is either an ordinary finding or a numbered pass ledger, both
// of which are work rows like any other. `epic` already exempts the standing family parents. When a
// genuinely standing ledger earns its own label, it joins this array — one line, reviewed.
// `blocked` is deliberately absent: waiting is not immortal either.
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
const exec_file_async = promisify(exec_file)
const is_record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const is_full_sha = (value) => /^[0-9a-f]{40}$/i.test(String(value ?? ''))

// ---------------------------------------------------------------------------
// Pure core — every decision this file makes is one of the functions below.
// ---------------------------------------------------------------------------

// GitHub's own close-keyword grammar: close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved,
// optionally `owner/repo`-qualified. A bare `#12` is a MENTION, not a close instruction, and is
// deliberately not matched here — see mentions_issue for the ref-gate's looser reading.
const CLOSE_REF_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi

// A fenced block is QUOTED EVIDENCE, never an instruction. Pull request bodies in this repo paste gate
// transcripts and logs, and a pasted `closes #1495 on landing` line is a report ABOUT a close, not a
// request for one — left unstripped it silently links the quoting pull request to a stranger's row.
// Measured on #1547, whose own driven-proof transcript made it claim to close #1495.
const FENCED_BLOCK_RE = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const without_quoted_blocks = (text) =>
  String(text ?? '')
    .replace(FENCED_BLOCK_RE, '\n')
    .replace(INLINE_CODE_RE, ' ')

export function parse_close_refs(text, repository) {
  const owned = String(repository ?? '').toLowerCase()
  const numbers = [...without_quoted_blocks(text).matchAll(CLOSE_REF_RE)]
    .filter(([, repo]) => !repo || repo.toLowerCase() === owned)
    .map(([, , number]) => Number(number))
    .filter((number) => Number.isSafeInteger(number) && number > 0)
  return [...new Set(numbers)].toSorted((left, right) => left - right)
}

// A push checkout only proves the new tree. The event payload is the authority for what this one
// landing added, including a multi-commit fast-forward; resolving HEAD^ would silently inspect just
// the tip commit. Kept pure so fixture payloads exercise the exact GitHub boundary.
export function resolve_landing_range(push_event) {
  if (!is_record(push_event)) throw new Error('push event must be an object')
  if (push_event.ref !== 'refs/heads/edge')
    throw new Error(`landing push must target edge, got ${push_event.ref ?? '<none>'}`)
  const base = String(push_event.before ?? '')
  const head = String(push_event.after ?? '')
  if (!(is_full_sha(base) && is_full_sha(head))) throw new Error('landing push needs full before and after SHAs')
  if (base === ZERO_SHA || head === ZERO_SHA || push_event.deleted === true)
    throw new Error('branch creation/deletion has no landed commit range')
  if (base.toLowerCase() === head.toLowerCase()) throw new Error('landing push range is empty')
  return { base, head }
}

// The ref-gate asks the looser question ("did this PR reference ANY row?"). A deliberate `Refs #123`
// means the contributor considered the board; warning on it would be noise.
export const mentions_issue = (text) => /#\d+\b/.test(String(text ?? ''))

const CONVENTIONAL_SUBJECT_RE = /^(?:fix|feat|refactor|perf|ci|test|docs|chore)(?:\([^)\r\n]+\))?!?:\s/i
export const is_conventional_subject = (title) => CONVENTIONAL_SUBJECT_RE.test(String(title ?? '').trim())

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
  // `/issues/N` answers for pull requests too, and a body may legitimately name one ("Fixes #1502",
  // where 1502 is an oracle PR rather than a row). Closing a peer pull request is the one mutation
  // this pass must never make; the `pull_request` key is what tells the two apart.
  if (issue?.pull_request) return { action: 'noop', reason: 'a pull request, not a board row' }
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

const label_names = (item) => (item?.labels ?? []).map((label) => label?.name ?? label)

// The blocking gate. It deliberately asks the STRICT question the loose ref gate below does not: not
// "did the author think about the board" but "will a row actually drain when this lands". The sources
// and the parser are the landing pass's own — see the parity test — so a `close-ref` verdict is a
// promise the landing pass keeps, not a second opinion about it.
//
// THE ASYMMETRY, ON PURPOSE (owner ruling): `registered_total` is the count from
// `closingIssuesReferences`, which a maintainer can populate by hand through the pull request's
// Development panel. It is accepted here as PROOF that a human linked the row — but it is NOT, and
// must never become, a source the landing pass closes from. That pass reads TEXT, and only text.
// A pull request that passes on this arm alone therefore drains NOTHING on landing; the gate says so
// out loud in its message rather than letting a green check imply a close that will not happen.
// Precedence is deliberate: the parser first, so the arm that actually closes is the one reported.
export const link_candidates = (pull_request, commits, repository) =>
  parse_close_refs(
    [...(commits ?? []).map((commit) => commit?.commit?.message), pull_request?.title, pull_request?.body]
      .filter(Boolean)
      .join('\n'),
    repository
  )

export function decide_link_gate(pull_request, commits, repository, options = {}) {
  const { registered_total = 0, closable_refs = null, rejected_refs = [] } = options
  const candidates = link_candidates(pull_request, commits, repository)
  // `closable_refs: null` means NO target verification was performed — the offline reading, where the
  // parse is the whole answer. The driven gate always supplies the verified list, so a ref pointing at
  // a pull request or an already-closed row can never buy a pass there.
  const refs = closable_refs === null ? candidates : candidates.filter((number) => closable_refs.includes(number))
  if (refs.length > 0) return { ok: true, refs, via: 'close-ref' }
  if (label_names(pull_request).includes(NO_ISSUE_LABEL)) return { ok: true, refs: [], via: 'no-issue' }
  if (Number(registered_total) > 0)
    return { ok: true, refs: [], via: 'registered-link', registered: Number(registered_total) }
  return { ok: false, refs: [], via: 'none', rejected: rejected_refs }
}

export const link_gate_message = (decision) => {
  if (decision.ok && decision.via === 'no-issue') return `closes no row on purpose — carries \`${NO_ISSUE_LABEL}\``
  if (decision.ok && decision.via === 'registered-link')
    return `${decision.registered} row(s) linked by hand through the Development panel — accepted as proof. NOTE: the landing pass closes from TEXT only, so nothing drains automatically; add \`Fixes #N\` to the body if you want the row closed on landing.`
  if (decision.ok) return `closes ${decision.refs.map((number) => `#${number}`).join(', ')} on landing`
  // A ref that named something unclosable is the confusing failure — the body LOOKS linked. Say which
  // ref and why before teaching the syntax, or the author reads "add Fixes #N" and swears they did.
  const why = (decision.rejected ?? []).map((row) => `#${row.number} is ${row.why}`).join('; ')
  const preamble = why ? `the refs in this body close nothing — ${why}. ` : ''
  return `${preamble}nothing drains when this lands — add \`Fixes #N\` pointing at an OPEN ISSUE (a SPACE after the keyword, never \`Fixes-#N\`), link the row by hand in the Development panel, or apply the \`${NO_ISSUE_LABEL}\` label if this pull request deliberately closes no row.`
}

export function decide_ref_gate(pull_request, commits, comments) {
  if (!is_conventional_subject(pull_request?.title))
    return { action: 'noop', reason: 'not a conventional pull request' }
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
    '**No issue ref.** This conventional pull request references no row, so the close chain is broken:',
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

export const assert_repository = (repository) => {
  const parts = String(repository).split('/')
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part)))
    throw new Error('GITHUB_REPOSITORY must be owner/name')
  return parts.join('/')
}

const api_url = (config, path_name, params = {}) => {
  const repository = assert_repository(config.repository)
  const url = new URL(`/repos/${repository}${path_name}`, GITHUB_API_ORIGIN)
  url.search = new URLSearchParams(params).toString()
  return url.href
}

const get_json = async (config, path_name, params) => {
  const { data } = await request_json(api_url(config, path_name, params), { config, delay_ms: READ_DELAY_MS })
  return data
}

// The landing issue's boundary explicitly uses `gh api`: arguments are passed without a shell, and
// the token stays in the child environment rather than appearing in argv or logs.
const get_gh_json = async (config, path_name) => {
  const repository = assert_repository(config.repository)
  const { stdout } = await exec_file_async('gh', ['api', `repos/${repository}${path_name}`], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: config.github_token },
    maxBuffer: GH_API_MAX_BUFFER,
  })
  return JSON.parse(stdout)
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

// Pure half of the push pass. The compare endpoint resolves every commit in before..after; GitHub's
// associated-pulls endpoint supplies the PR bodies. Bodies are the close contract contributors edit
// and review, so commit messages, PR titles, unrelated-base PRs, and quoted transcript refs do not
// become mutation instructions here.
export function extract_landed_references(compare, associated_pulls, repository) {
  const commits = Array.isArray(compare?.commits) ? compare.commits : []
  const pulls_by_sha = is_record(associated_pulls) ? associated_pulls : {}
  return commits.reduce((found, commit) => {
    const sha = String(commit?.sha ?? '')
    if (!is_full_sha(sha)) throw new Error('compare payload contains a commit without a full SHA')
    const pulls = pulls_by_sha[sha]
    if (!Array.isArray(pulls)) throw new Error(`associated pull payload missing for ${sha}`)
    return pulls
      .filter((pull) => pull?.base?.ref === 'edge')
      .reduce(
        (from_pulls, pull) =>
          parse_close_refs(pull?.body, repository).reduce(
            (from_refs, number) =>
              merge_evidence(from_refs, number, {
                sha,
                pr_number: Number.isSafeInteger(Number(pull?.number)) ? Number(pull.number) : null,
              }),
            from_pulls
          ),
        found
      )
  }, new Map())
}

async function pushed_landings(config) {
  const { base, head } = config.push_event ? resolve_landing_range(config.push_event) : config
  const compare = await get_gh_json(config, `/compare/${base}...${head}`)
  const commits = Array.isArray(compare?.commits) ? compare.commits : []
  const associated_pulls = {}
  for (const commit of commits) {
    const sha = String(commit?.sha ?? '')
    associated_pulls[sha] = await get_gh_json(config, `/commits/${sha}/pulls`)
  }
  return extract_landed_references(compare, associated_pulls, config.repository)
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
// Pass 5 — the link gate (blocking).
// ---------------------------------------------------------------------------

const REGISTERED_LINKS_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){ closingIssuesReferences(first:1){ totalCount } } }
}`

// The hand-linked count. Queried ONLY when the text arms have already come up empty — the parser is
// the compliance signal that costs nothing and means something, so the common path never spends this
// request, and a GraphQL hiccup can never red a pull request that carried a keyword all along.
export async function registered_link_total(config) {
  const [owner, name] = String(config.repository).split('/')
  const { data } = await request_json(`${GITHUB_API_ORIGIN}/graphql`, {
    config,
    method: 'POST',
    delay_ms: READ_DELAY_MS,
    body: { query: REGISTERED_LINKS_QUERY, variables: { owner, name, number: config.pull_number } },
  })
  return Number(data?.data?.repository?.pullRequest?.closingIssuesReferences?.totalCount ?? 0)
}

// A ref only counts as linkage if it names something the landing pass could actually close: an OPEN
// ISSUE. `#1399` naming a merged pull request, or `#1168` naming an already-closed row, reads as
// linked and drains nothing — both were live on this board. LAZY on purpose: candidates are resolved
// one at a time and the walk STOPS at the first closable row, so the ordinary one-ref pull request
// costs exactly one request and only a body full of dead refs ever costs more.
export async function closable_link_refs(config, candidates) {
  return candidates.reduce(
    async (state_promise, number) => {
      const state = await state_promise
      if (state.closable.length > 0) return state
      const target = await get_json(config, `/issues/${number}`)
      if (target?.pull_request)
        return { ...state, rejected: [...state.rejected, { number, why: 'a pull request, not an issue' }] }
      if (target?.state !== 'open')
        return { ...state, rejected: [...state.rejected, { number, why: 'an already-closed row' }] }
      return { ...state, closable: [...state.closable, number] }
    },
    Promise.resolve({ closable: [], rejected: [] })
  )
}

export async function run_link_gate(config) {
  const pull_request = await get_json(config, `/pulls/${config.pull_number}`)
  const commits = await collect_pages(
    config,
    api_url(config, `/pulls/${config.pull_number}/commits`, { per_page: '100' })
  )
  const candidates = link_candidates(pull_request, commits, config.repository)
  const { closable, rejected } =
    candidates.length > 0 ? await closable_link_refs(config, candidates) : { closable: [], rejected: [] }
  const from_text = decide_link_gate(pull_request, commits, config.repository, {
    closable_refs: closable,
    rejected_refs: rejected,
  })
  const decision = from_text.ok
    ? from_text
    : decide_link_gate(pull_request, commits, config.repository, {
        closable_refs: closable,
        rejected_refs: rejected,
        registered_total: await registered_link_total(config),
      })
  config.log(`link-gate: #${config.pull_number} ${decision.ok ? 'PASS' : 'FAIL'} — ${link_gate_message(decision)}`)
  return decision
}

// ---------------------------------------------------------------------------
// CLI edge.
// ---------------------------------------------------------------------------

const MODES = {
  landing: run_landing,
  backstop: run_landing,
  stale: run_stale,
  'ref-gate': run_ref_gate,
  'link-gate': run_link_gate,
}

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
      `usage: board_hygiene.mjs <${Object.keys(MODES).join('|')}> [--dry-run] [--event PATH | --base SHA --head SHA] [--pr N] [--since-days N]`
    )
  return {
    mode,
    dry_run: argv.includes('--dry-run'),
    event_path: flag_value(argv, 'event'),
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
  if (args.mode === 'landing' && !(args.event_path || (args.base && args.head)))
    throw new Error('landing mode needs --event or --base and --head')
  if (args.mode === 'ref-gate' && !Number.isSafeInteger(args.pull_number)) throw new Error('ref-gate mode needs --pr')
  if (args.mode === 'link-gate' && !(Number.isSafeInteger(args.pull_number) && args.pull_number > 0))
    throw new Error('link-gate mode needs --pr')
  const config = {
    ...args,
    push_event: args.event_path ? JSON.parse(read_file_sync(args.event_path, 'utf8')) : null,
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
  // The only pass that can fail a run: a gate says no by exiting non-zero. Every other pass reports.
  if (is_record(summary) && summary.ok === false) process.exitCode = 1
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main) {
  main().catch((error) => {
    console.error('board hygiene failed', error)
    process.exitCode = 1
  })
}
