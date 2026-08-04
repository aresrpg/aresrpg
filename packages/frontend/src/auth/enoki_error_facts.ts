// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ─────────────────────────────────────────────────────────────────────────────
//  enoki_error_facts.ts — what a zkLogin rejection is allowed to tell us (#2192)
// ─────────────────────────────────────────────────────────────────────────────
//  A failed Enoki proving call is the only witness to the create-character failure class, and one line later
//  it is gone: the sponsor path converts it into localized toast copy, which is what reaches the error store —
//  a French sentence that discriminates nothing. These are the fields that DO discriminate (is it a 400 or a
//  403? which code? whose epoch expired?), reduced to plain data.
//
//  Reporting the raw error instead is not an option: an auth failure's message and response body are precisely
//  where a live id_token, a zk proof or an ephemeral key would be echoed back at us, and an error store is a
//  third party. So every string here goes through redact_auth_secrets (core/redact.ts, the one home for those
//  shapes) and is capped — the cause stays readable, the credential never leaves the browser. PURE: no I/O, no
//  throwing, defined for any input shape.

import { redact_auth_secrets } from '../core/redact'

const DETAIL_LIMIT = 300

export type EnokiErrorFacts = Readonly<{
  name: string
  status: number | null
  codes: readonly string[]
  detail: string
}>

const parsed_errors = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const decoded = JSON.parse(value) as { errors?: unknown }
    return Array.isArray(decoded?.errors) ? decoded.errors : []
  } catch {
    return [] // an unparseable body carries no codes — the detail below still reports what happened
  }
}

/** The `code` strings Enoki names its refusals with (`jwt_error`, `invalid_proof`, …), in order. PURE. */
const error_codes = (error: Record<string, unknown>): readonly string[] =>
  [...parsed_errors(error.errors), ...parsed_errors(error.response_body)]
    .map((entry) => (entry as { code?: unknown })?.code)
    .filter((code): code is string => typeof code === 'string')
    .map(redact_auth_secrets)

/**
 * The reportable facts of a rejection from the zkLogin sign path — safe to put in an error store, whatever the
 * SDK threw. PURE.
 */
export const enoki_error_facts = (error: unknown): EnokiErrorFacts => {
  if (error == null || typeof error !== 'object')
    return {
      name: error === null ? 'null' : typeof error,
      status: null,
      codes: [],
      detail: redact_auth_secrets(typeof error === 'string' ? error : String(error ?? '')).slice(0, DETAIL_LIMIT),
    }
  const bag = error as Record<string, unknown>
  const status = typeof bag.status === 'number' ? bag.status : null
  const message = typeof bag.message === 'string' ? bag.message : ''
  return {
    name: typeof bag.name === 'string' && bag.name ? bag.name : 'Error',
    status,
    codes: [...new Set(error_codes(bag))],
    detail: redact_auth_secrets(message).slice(0, DETAIL_LIMIT),
  }
}

/**
 * The error the proving instrument reports: the redacted facts, flattened into one grouping-friendly message
 * under its own type. It is a fresh error on purpose — attaching the raw rejection as `cause` would hand it
 * straight back to Sentry's linked-errors integration, which is the leak this module exists to prevent. Its
 * message carries the redacted detail, so a rejection that is really a benign class (the player closed the
 * popup) still meets the reporter's own drop list and never becomes an event. PURE.
 */
export const zklogin_proving_error = (facts: EnokiErrorFacts): Error => {
  const status = facts.status == null ? '' : ` ${facts.status}`
  const codes = facts.codes.length ? ` [${facts.codes.join(', ')}]` : ''
  const error = new Error(`zkLogin proving rejected — ${facts.name}${status}${codes}: ${facts.detail}`)
  error.name = 'ZkLoginProvingError'
  return error
}
