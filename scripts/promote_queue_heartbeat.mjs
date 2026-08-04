#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure reader for promote-queue's schedule heartbeat. The producer writes one ISO timestamp;
// this watcher distinguishes a silent scheduler from an idle queue without touching queue logic.
import fs from 'node:fs'
import { fileURLToPath as file_url_to_path } from 'node:url'

export const HEARTBEAT_STALE_AFTER_MS = 30 * 60 * 1000

export function decide_promote_queue_heartbeat(raw_timestamp, now_ms = Date.now()) {
  const timestamp = String(raw_timestamp ?? '').trim()
  if (timestamp.length === 0) return { state: 'missing', age_ms: null, timestamp: null }
  const heartbeat_ms = Date.parse(timestamp)
  if (!Number.isFinite(heartbeat_ms)) return { state: 'invalid', age_ms: null, timestamp }
  const age_ms = now_ms - heartbeat_ms
  return {
    state: age_ms > HEARTBEAT_STALE_AFTER_MS ? 'stale' : 'fresh',
    age_ms,
    timestamp,
  }
}

const age_minutes = (age_ms) => Math.max(0, age_ms / 60_000).toFixed(1)

export function heartbeat_verdict_line(decision) {
  if (decision.state === 'missing')
    return 'GitHub stopped scheduling promote-queue — no cached schedule heartbeat was restored'
  if (decision.state === 'invalid') return 'promote-queue heartbeat unreadable — expected an ISO-8601 run timestamp'
  if (decision.state === 'stale')
    return `GitHub stopped scheduling promote-queue — newest heartbeat is ${age_minutes(decision.age_ms)} min old (>30 min)`
  return `promote-queue schedule heartbeat fresh — ${age_minutes(decision.age_ms)} min old`
}

function run(file_path = process.argv[2]) {
  let raw_timestamp = ''
  try {
    raw_timestamp = fs.readFileSync(file_path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(
        '::error title=promote-queue heartbeat::promote-queue heartbeat unreadable — cache file read failed'
      )
      return 1
    }
  }
  const decision = decide_promote_queue_heartbeat(raw_timestamp)
  const line = heartbeat_verdict_line(decision)
  if (decision.state !== 'fresh') console.error(`::error title=promote-queue heartbeat::${line}`)
  else console.log(line)
  return decision.state === 'fresh' ? 0 : 1
}

if (process.argv[1] && file_url_to_path(import.meta.url) === process.argv[1]) process.exitCode = run()
