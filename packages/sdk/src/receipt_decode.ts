// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const event_string = (event: Readonly<Record<string, unknown>>, field: string): string => {
  const value = event[field]
  if (typeof value !== 'string' || !value) throw new Error(`Receipt event field ${field} is invalid`)
  return value
}

export const event_integer = (event: Readonly<Record<string, unknown>>, field: string): number => {
  const value = event[field]
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Receipt event field ${field} is invalid`)
  return parsed
}

export const event_u64 = (event: Readonly<Record<string, unknown>>, field: string): string => {
  const value = event[field]
  const rendered = typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value : null
  if (rendered === null || !/^\d+$/u.test(rendered)) throw new Error(`Receipt event field ${field} is invalid`)
  return rendered
}

export const event_boolean = (event: Readonly<Record<string, unknown>>, field: string): boolean => {
  const value = event[field]
  if (typeof value !== 'boolean') throw new Error(`Receipt event field ${field} is invalid`)
  return value
}
