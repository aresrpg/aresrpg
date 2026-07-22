#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Tails the Rust indexer's ERROR-only JSONL file and forwards only records marked
// `sentry_event=true`. Framework ERROR records stay in the log but are ignored so
// one propagated failure creates one Sentry event with an explicit fingerprint.
import { open, readFile as read_file, rename, writeFile as write_file } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import * as Sentry from '@sentry/node'

import { init_reporting, is_reporting_live, report_error } from './report.js'

const DEFAULT_LOG_PATH = '/var/log/aresrpg/indexer-errors.jsonl'
const DEFAULT_POLL_MS = 1000
const MAX_READ_BYTES = 1024 * 1024

const is_record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export function parse_indexer_log_line(line) {
  let record
  try {
    record = JSON.parse(line)
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
  if (!is_record(record) || !is_record(record.fields)) return { ok: false, error: 'invalid_record' }
  if (record.fields.sentry_event !== true) return { ok: true, event: null }

  const { fields } = record
  const error_chain = typeof fields.error_chain === 'string' ? fields.error_chain : ''
  const error_type = typeof fields.error_type === 'string' ? fields.error_type : ''
  const culprit = typeof fields.culprit === 'string' ? fields.culprit : ''
  const sentry_fingerprint = typeof fields.sentry_fingerprint === 'string' ? fields.sentry_fingerprint : ''
  if (!error_chain || !error_type || !culprit || !sentry_fingerprint)
    return { ok: false, error: 'incomplete_sentry_record' }

  return {
    ok: true,
    event: {
      message: error_chain,
      error_type,
      culprit,
      fingerprint: ['indexer', sentry_fingerprint],
      context: {
        ...(typeof record.timestamp === 'string' ? { log_timestamp: record.timestamp } : {}),
        ...(typeof record.target === 'string' ? { target: record.target } : {}),
      },
    },
  }
}

export async function forward_indexer_lines(
  lines,
  {
    report_error: capture = report_error,
    flush = Sentry.flush,
    reporting_live = is_reporting_live,
    on_invalid = (reason) => console.error(`indexer log ship: skipped ${reason}`),
  } = {}
) {
  const decoded = lines.map(parse_indexer_log_line)
  const invalid = decoded.filter((result) => !result.ok)
  invalid.forEach((result) => on_invalid(result.error))
  const events = decoded.flatMap((result) => (result.ok && result.event ? [result.event] : []))
  events.forEach((event) => {
    const failure = new Error(event.message)
    failure.name = event.error_type
    capture(failure, {
      area: 'indexer',
      action: event.culprit,
      fingerprint: event.fingerprint,
      ...event.context,
    })
  })
  // @sentry/node reports `false` from flush() when it was never initialised.
  // Preserve report.js's hard no-op convention without pinning the cursor on a
  // record that can never be sent because this deployment intentionally has no DSN.
  if (events.length > 0 && reporting_live() && !(await flush(2000)))
    throw new Error('timed out flushing indexer errors to Sentry')
  return { forwarded_count: events.length, invalid_count: invalid.length }
}

async function read_cursor(cursor_path) {
  try {
    const raw = (await read_file(cursor_path, 'utf8')).trim()
    if (!/^\d+$/.test(raw)) throw new Error(`invalid cursor in ${cursor_path}`)
    return Number(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

async function read_complete_lines(log_path, cursor) {
  let handle
  try {
    handle = await open(log_path, 'r')
  } catch (error) {
    if (error?.code === 'ENOENT') return { lines: [], next_cursor: cursor }
    throw error
  }

  try {
    const { size } = await handle.stat()
    const start = size < cursor ? 0 : cursor
    const read_size = Math.min(size - start, MAX_READ_BYTES)
    if (read_size === 0) return { lines: [], next_cursor: start }
    const buffer = Buffer.alloc(read_size)
    const { bytesRead: bytes_read } = await handle.read(buffer, 0, read_size, start)
    const bytes = buffer.subarray(0, bytes_read)
    const last_newline = bytes.lastIndexOf(10)
    if (last_newline === -1) return { lines: [], next_cursor: start }
    const lines = bytes.subarray(0, last_newline).toString('utf8').split('\n').filter(Boolean)
    return { lines, next_cursor: start + last_newline + 1 }
  } finally {
    await handle.close()
  }
}

async function write_cursor(cursor_path, cursor) {
  const temporary_path = `${cursor_path}.${process.pid}.tmp`
  await write_file(temporary_path, `${cursor}\n`)
  await rename(temporary_path, cursor_path)
}

export async function ship_indexer_errors_once({ log_path, cursor_path }) {
  const cursor = await read_cursor(cursor_path)
  const batch = await read_complete_lines(log_path, cursor)
  if (batch.next_cursor === cursor) return { forwarded_count: 0, invalid_count: 0 }
  const result = await forward_indexer_lines(batch.lines)
  await write_cursor(cursor_path, batch.next_cursor)
  return result
}

const wait = (delay_ms) => new Promise((resolve) => setTimeout(resolve, delay_ms))

export async function tail_indexer_errors({ log_path, cursor_path, poll_ms = DEFAULT_POLL_MS }) {
  for (;;) {
    await ship_indexer_errors_once({ log_path, cursor_path })
    await wait(poll_ms)
  }
}

async function main() {
  init_reporting()
  const log_path = process.env.INDEXER_ERROR_LOG || DEFAULT_LOG_PATH
  const cursor_path = process.env.INDEXER_ERROR_CURSOR || `${log_path}.cursor`
  await tail_indexer_errors({ log_path, cursor_path })
}

const is_main = process.argv[1] && path.resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main) {
  main().catch((error) => {
    console.error('indexer log ship failed', error)
    process.exitCode = 1
  })
}
