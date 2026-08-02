// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Raw provider failures become player copy exactly once: where they enter the app-toast surface.

import i18n from './i18n'

export type ToastErrorCopy = Readonly<{ message: string; diagnostic: boolean }>

/**
 * THE CLASS GUARD (#2032) — a player toast rendered `[object Object] Resetting the streams.` because a raw
 * Error/object reached a toast door where a message STRING belongs, and the door stringified it with
 * `String(input)`. `[object Object]` is never player copy, so the doors themselves refuse the shape: the
 * message is extracted ONCE, here, at the boundary. A caller that hands over an Error gets its `.message`; a
 * shape carrying no message gets the honest generic copy (`diagnostic` tells the door to keep the raw value
 * in the sanctioned error console, exactly like `decode_toast_error`). Pure — the report is the door's effect.
 */
export function toast_message(input: unknown): ToastErrorCopy {
  if (typeof input === 'string') return { message: input, diagnostic: false }
  if (input == null) return { message: '', diagnostic: false }
  if (typeof input === 'object') {
    const { message } = input as Readonly<{ message?: unknown }>
    // An Error (or any shape carrying player-readable text) still says what happened — the object tag never does.
    if (typeof message === 'string' && message.trim()) return { message, diagnostic: true }
    return { message: i18n.t('errors.request_failed'), diagnostic: true }
  }
  // Numbers/booleans stringify honestly; only object-shaped inputs can produce the `[object Object]` tag.
  return { message: String(input), diagnostic: true }
}

const rejection_re =
  /user (?:rejected|denied|cancel(?:l)?ed)|rejected the request|request rejected|signature (?:was )?rejected/i
const pending_re = /request.{0,40}(?:already )?pending|already processing|wallet_requestpermissions already pending/i
const wallet_unavailable_re =
  /walletnotconnected|wallet.{0,40}(?:disconnected|not connected|unavailable|not found)|no account selected/i
const rpc_re = /json[- ]?rpc|rpc(?:response)?error|failed to fetch|network error|service unavailable|gateway timeout/i

const chain_values = (current: unknown, values: ReadonlyArray<unknown> = []): ReadonlyArray<unknown> => {
  if (current == null || values.includes(current) || values.length >= 5) return values
  const next_values = [...values, current]
  if (typeof current !== 'object') return next_values
  const row = current as Readonly<Record<string, unknown>>
  return chain_values(row.cause ?? row.error ?? row.data, next_values)
}

const error_text = (values: ReadonlyArray<unknown>) =>
  values
    .flatMap((value) => {
      if (typeof value === 'string') return [value]
      if (value == null || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      return [row.name, row.message].filter((part): part is string => typeof part === 'string')
    })
    .join(' ')

const error_codes = (values: ReadonlyArray<unknown>): ReadonlyArray<string | number> =>
  values.flatMap((value) => {
    if (value == null || typeof value !== 'object') return []
    const { code } = value as Readonly<Record<string, unknown>>
    return typeof code === 'string' || typeof code === 'number' ? [code] : []
  })

const has_code = (codes: ReadonlyArray<string | number>, expected: string | number) =>
  codes.some((code) => String(code).toUpperCase() === String(expected).toUpperCase())

const rpc_code = (codes: ReadonlyArray<string | number>) =>
  codes.some((code) => {
    const numeric = Number(code)
    return Number.isInteger(numeric) && numeric >= -32700 && numeric <= -32000
  })

/**
 * Pure toast-boundary decoder. `diagnostic` tells the edge to retain the raw provider detail in the
 * sanctioned error console; clean player copy remains untouched.
 */
export function decode_toast_error(error: unknown): ToastErrorCopy {
  if (typeof error === 'string') {
    const key = `toast.${error}`
    const translated = i18n.t(key)
    if (translated !== key) return { message: translated, diagnostic: false }
  }

  const values = chain_values(error)
  const text = error_text(values)
  const codes = error_codes(values)
  if (has_code(codes, 4001) || has_code(codes, 'USER_REJECTED') || rejection_re.test(text))
    return { message: i18n.t('errors.wallet_request_rejected'), diagnostic: true }
  if (has_code(codes, -32002) || has_code(codes, 'REQUEST_ALREADY_PENDING') || pending_re.test(text))
    return { message: i18n.t('errors.wallet_request_pending'), diagnostic: true }
  if (has_code(codes, 'WALLET_NOT_CONNECTED') || wallet_unavailable_re.test(text))
    return { message: i18n.t('errors.wallet_unavailable'), diagnostic: true }
  if (rpc_code(codes) || rpc_re.test(text)) return { message: i18n.t('errors.rpc_unavailable'), diagnostic: true }
  if (error != null && typeof error === 'object') return { message: i18n.t('errors.request_failed'), diagnostic: true }
  return {
    message: typeof error === 'string' ? error : i18n.t('errors.request_failed'),
    diagnostic: error != null && typeof error !== 'string',
  }
}
