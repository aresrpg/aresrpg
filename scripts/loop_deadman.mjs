#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE LOOP DEAD-MAN — CI notices when a session-side loop goes dark.
//
// ROOT CAUSE: the standing passes in `.claude/loops/` run inside an agent session on a laptop.
// Twice in three days that laptop closed and nothing anywhere noticed for hours — the detector and
// the thing it detects shared a power switch. `.claude/rules/doctrine.md`'s ladder calls that a law
// still kept in prose. This file is its CANNOT rung, on GitHub's side of the wire.
//
// IT DOES NOT RUN A PASS: CI has no model runtime, and an alarm that pretends to do the work it is
// alarming about is worse than silence. It reads ONE board-visible artifact per loop, compares its
// age to a bar, and files exactly one reminder row. A loop is checkable here only if every pass
// leaves such an artifact; the rest are simply absent from the table below.
//
// BOARD TEXT IS DATA. Bodies are matched against one anchored regex — the loop rubric's OWN regex,
// unchanged, because a cursor and its watchdog disagreeing about what an anchor is would be a
// second source of truth about the loop's heartbeat — and never executed, never shell-interpolated
// (every GitHub call below is `gh` with an argv array), and never allowed to manufacture the
// HTML-comment marker this file uses as its idempotency protocol. An anchor counts only from an
// author with write access here or from the repo's own CI identity: a stranger's comment can no
// more silence this alarm than it can approve a landing.
import { execFile as exec_file } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'
import { promisify } from 'node:util'

// One home for the owner/name assertion — board_hygiene.mjs is already an imported module in this
// repo (see .github/workflows/checks.yml, which imports its parser), and a second copy of this
// check is exactly the dual-home class the architecture-audit loop hunts.
import { assert_repository } from './board_hygiene.mjs'

const HOUR_MS = 3_600_000
const GH_MAX_BUFFER = 16 * 1024 * 1024

export const CI_LOGIN = 'github-actions[bot]'
export const REMINDER_LABEL = 'tech-debt'

// A trusted anchor author is one GitHub itself says has write access here, plus the repo's own CI
// identity (whose association on a comment is not a permission statement).
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

// ---------------------------------------------------------------------------
// THE STALENESS TABLE — one row per loop. Adding a loop is one row.
//   name              the loop, as `.claude/loops/<name>.md` names it
//   issue_number      the standing board row its passes write to
//   anchor_pattern    the machine line a completed pass leaves, capturing its payload
//   stale_after_hours the bar, in HOURS. GitHub's scheduler routinely fires 30-100 minutes late,
//                     so a minute-grade bar would page on lateness rather than on death — every
//                     bar here is the loop's cadence plus hours of slack.
//   rubric            where a reader goes to learn what the loop was supposed to be doing
// ---------------------------------------------------------------------------
export const LOOPS = [
  {
    name: 'architecture-audit',
    issue_number: 1357,
    anchor_pattern: /^architecture-audit-anchor: ([0-9a-f]{40})$/m,
    // Full pass cadence is ~4h; 12h is three missed passes — dead, not late.
    stale_after_hours: 12,
    rubric: '.claude/loops/architecture-audit.md',
  },
]

// ---------------------------------------------------------------------------
// Pure core — every decision this file makes is one of the functions below.
// ---------------------------------------------------------------------------

const is_trusted_author = (comment) =>
  comment?.user?.login === CI_LOGIN || TRUSTED_ASSOCIATIONS.has(comment?.author_association)

// The newest trusted anchor, or null. `created_at` is the record's clock, exactly as the loop
// rubric's own cursor read selects it.
export function newest_anchor(comments, loop) {
  const anchors = (comments ?? [])
    .filter(is_trusted_author)
    .map((comment) => ({ comment, match: loop.anchor_pattern.exec(String(comment?.body ?? '')) }))
    .filter(({ match, comment }) => match !== null && Number.isFinite(Date.parse(comment?.created_at ?? '')))
  if (anchors.length === 0) return null
  const newest = anchors.reduce((best, row) =>
    Date.parse(row.comment.created_at) > Date.parse(best.comment.created_at) ? row : best
  )
  return {
    created_at_ms: Date.parse(newest.comment.created_at),
    author: newest.comment.user?.login ?? null,
    sha: newest.match[1],
    url: newest.comment.html_url ?? null,
  }
}

// FAIL CLOSED: no readable anchor is `missing`, never a plausible fresh. An instrument that cannot
// measure must say so — a watchdog that reports health when its own input is absent is the failure
// mode it exists to prevent.
export function decide_loop(loop, anchor, now_ms) {
  if (!anchor) return { loop: loop.name, state: 'missing', age_hours: null, anchor: null }
  const age_hours = (now_ms - anchor.created_at_ms) / HOUR_MS
  return { loop: loop.name, state: age_hours > loop.stale_after_hours ? 'stale' : 'fresh', age_hours, anchor }
}

export const reminder_title = (loop) => `loop-deadman: ${loop.name} stale`
export const reminder_marker = (loop) => `<!-- loop_deadman ${loop.name} -->`

// This pass's own beat on its own alarm row: the newest thing IT wrote there. A human reply is
// activity on the row but says nothing about when the alarm last sounded, so it is not counted —
// otherwise a conversation on the issue would suppress every refresh.
const MARKER_RE = /^<!-- loop_deadman [a-z0-9-]+ -->$/m
const carries_marker = (body) => MARKER_RE.test(String(body ?? ''))
export function last_reminder_beat(issue, comments) {
  const stamps = [
    ...(carries_marker(issue?.body) ? [Date.parse(issue?.created_at ?? '')] : []),
    ...(comments ?? [])
      .filter((comment) => comment?.user?.login === CI_LOGIN && carries_marker(comment?.body))
      .map((comment) => Date.parse(comment?.created_at ?? '')),
  ].filter(Number.isFinite)
  return stamps.length > 0 ? Math.max(...stamps) : null
}

// EXACTLY ONE ALARM ROW PER LOOP: open it, re-sound it once per staleness window while the loop
// stays dark, close it the moment the loop reports for duty. Nothing else.
export function decide_reminder(loop, decision, reminder, now_ms) {
  const breached = decision.state !== 'fresh'
  if (!reminder) return breached ? { action: 'open' } : { action: 'noop', reason: 'alive, no alarm open' }
  if (!breached) return { action: 'close' }
  const since_ms = reminder.last_beat_ms === null ? Infinity : now_ms - reminder.last_beat_ms
  return since_ms >= loop.stale_after_hours * HOUR_MS
    ? { action: 'refresh' }
    : { action: 'noop', reason: 'already reminded inside this window' }
}

// ---------------------------------------------------------------------------
// Comment bodies — one home per sentence the board will read.
// ---------------------------------------------------------------------------

const anchor_evidence = (loop, decision) =>
  decision.anchor
    ? [
        `Newest \`${loop.name}\` artifact: [${new Date(decision.anchor.created_at_ms).toISOString()}](${decision.anchor.url})`,
        `by \`${decision.anchor.author}\` on #${loop.issue_number}, cursor \`${decision.anchor.sha.slice(0, 12)}\` —`,
        `**${decision.age_hours.toFixed(1)}h** old against a **${loop.stale_after_hours}h** bar.`,
      ].join(' ')
    : `No readable \`${loop.name}\` artifact on #${loop.issue_number} at all — the bar is **${loop.stale_after_hours}h** and there is nothing to measure.`

export const reminder_body = (loop, decision) =>
  [
    `The \`${loop.name}\` loop has not written to the board inside its staleness bar.`,
    '',
    anchor_evidence(loop, decision),
    '',
    `The loop's rubric is \`${loop.rubric}\`; its passes run in an agent session, not in CI, which is why`,
    'this row exists: the loop and its detector must not share a power switch. This is an ALARM and',
    `nothing more — it does not run the pass, and it makes no claim about ${loop.name}'s findings.`,
    '',
    'It closes itself, citing the artifact, as soon as a fresh pass lands.',
    '',
    reminder_marker(loop),
  ].join('\n')

export const recovery_comment = (loop, decision) =>
  [`\`${loop.name}\` is running again — closing.`, '', anchor_evidence(loop, decision), '', reminder_marker(loop)].join(
    '\n'
  )

// ---------------------------------------------------------------------------
// Effects — the GitHub edge, one `gh` argv at a time (no shell, ever).
// ---------------------------------------------------------------------------

const exec_file_async = promisify(exec_file)

const real_gh = async (args) => {
  const { stdout } = await exec_file_async('gh', args, {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN },
    maxBuffer: GH_MAX_BUFFER,
  })
  return JSON.parse(stdout)
}

const list_comments = (config, issue_number) =>
  config.gh(['api', '--paginate', `repos/${config.repository}/issues/${issue_number}/comments?per_page=100`])

// Search, then VERIFY the title exactly: GitHub's search tokenizes, so `in:title` also returns rows
// whose titles merely contain the phrase. A near-match accepted here would let this pass comment on
// a stranger's row instead of its own alarm.
async function find_reminder(config, loop) {
  const title = reminder_title(loop)
  const found = await config.gh([
    'api',
    '-X',
    'GET',
    'search/issues',
    '-f',
    `q=repo:${config.repository} is:issue is:open in:title "${title}"`,
  ])
  if (found?.incomplete_results) throw new Error(`incomplete GitHub issue search for ${title}`)
  const match = (found?.items ?? []).find((item) => item?.title === title && item?.state === 'open')
  if (!match) return null
  // The search index is a snapshot; the row itself is the truth about when this alarm last sounded.
  const [issue, comments] = await Promise.all([
    config.gh(['api', `repos/${config.repository}/issues/${match.number}`]),
    list_comments(config, match.number),
  ])
  return { number: match.number, last_beat_ms: last_reminder_beat(issue, comments) }
}

const open_reminder = (config, loop, decision) =>
  config.gh([
    'api',
    '-X',
    'POST',
    `repos/${config.repository}/issues`,
    '-f',
    `title=${reminder_title(loop)}`,
    '-f',
    `body=${reminder_body(loop, decision)}`,
    '-f',
    `labels[]=${REMINDER_LABEL}`,
  ])

const post_comment = (config, issue_number, body) =>
  config.gh(['api', '-X', 'POST', `repos/${config.repository}/issues/${issue_number}/comments`, '-f', `body=${body}`])

const close_issue = (config, issue_number) =>
  config.gh([
    'api',
    '-X',
    'PATCH',
    `repos/${config.repository}/issues/${issue_number}`,
    '-f',
    'state=closed',
    '-f',
    'state_reason=completed',
  ])

async function apply_reminder(config, loop, decision, reminder, action) {
  if (action === 'noop') return
  if (config.dry_run) {
    config.log(`loop-deadman: WOULD ${action} the ${loop.name} alarm`)
    return
  }
  if (action === 'open') {
    await open_reminder(config, loop, decision)
    return
  }
  await post_comment(
    config,
    reminder.number,
    action === 'close' ? recovery_comment(loop, decision) : reminder_body(loop, decision)
  )
  if (action === 'close') await close_issue(config, reminder.number)
}

export async function run_deadman(config) {
  const loops = config.only ? LOOPS.filter((loop) => loop.name === config.only) : LOOPS
  if (loops.length === 0) throw new Error(`no loop named ${config.only} in the staleness table`)
  return loops.reduce(
    async (summary_promise, loop) => {
      const summary = await summary_promise
      const decision = decide_loop(
        loop,
        newest_anchor(await list_comments(config, loop.issue_number), loop),
        config.now_ms
      )
      const reminder = await find_reminder(config, loop)
      const { action, reason } = decide_reminder(loop, decision, reminder, config.now_ms)
      const age = decision.age_hours === null ? 'no artifact' : `${decision.age_hours.toFixed(1)}h old`
      config.log(
        `loop-deadman: ${loop.name} ${decision.state.toUpperCase()} (${age}, bar ${loop.stale_after_hours}h) → ${action}${reason ? ` (${reason})` : ''}`
      )
      await apply_reminder(config, loop, decision, reminder, action)
      return {
        checked: [
          ...summary.checked,
          { loop: loop.name, state: decision.state, age_hours: decision.age_hours, action },
        ],
        breached: decision.state === 'fresh' ? summary.breached : [...summary.breached, loop.name],
      }
    },
    Promise.resolve({ checked: [], breached: [] })
  )
}

// ---------------------------------------------------------------------------
// CLI edge.
// ---------------------------------------------------------------------------

const flag_value = (argv, name) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null
}

const required_env = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const argv = process.argv.slice(2)
  required_env('GITHUB_TOKEN')
  const config = {
    gh: real_gh,
    repository: assert_repository(required_env('GITHUB_REPOSITORY')),
    now_ms: Date.now(),
    dry_run: argv.includes('--dry-run'),
    only: flag_value(argv, 'loop'),
    log: (message) => console.log(message),
  }
  if (config.dry_run) console.log('loop dead-man: DRY RUN — no board mutation will be sent')
  const summary = await run_deadman(config)
  console.log(`loop dead-man complete: ${JSON.stringify(summary)}`)
  // A breach is a REPORT, not a red run: the alarm is the issue on the board. Failing the workflow
  // too would turn one dark loop into a permanently red scheduled check nobody can clear.
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main) {
  main().catch((error) => {
    console.error('loop dead-man failed', error)
    process.exitCode = 1
  })
}
