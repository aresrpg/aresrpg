// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type ErrorCopy = Readonly<{
  error_unknown: string
  error_recovered: string
  error_generic: string
  error_rejected: string
  error_funds: string
  error_connection: string
  error_session: string
}>

export const error_message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Expected, already-localized refusals remain distinct from provider diagnostics. */
export const localized_error = (message: string, cause?: unknown): Error =>
  Object.assign(new Error(message, { cause }), { name: 'LocalizedError' })

const ERROR_RULES = [
  [/^\[sdk\] transaction outcome unknown:/, 'error_unknown'],
  [/^\[sdk\] previous transaction recovered/, 'error_recovered'],
  [/rejected|denied|cancelled|canceled/i, 'error_rejected'],
  [/insufficient|not enough|gas coin|gas balance|no valid gas/i, 'error_funds'],
  [/session|no account|wallet.*unavailable|not authorized|no longer authorized/i, 'error_session'],
  [/network|fetch|connection|timed? ?out|timeout|unavailable|SLOW_CONSUMER|SNAPSHOT_FAILED/i, 'error_connection'],
] as const

export const error_text = (copy: ErrorCopy, error: unknown): string => {
  const message = error_message(error)
  const key = ERROR_RULES.find(([pattern]) => pattern.test(message))?.[1] ?? 'error_generic'
  return copy[key]
}
