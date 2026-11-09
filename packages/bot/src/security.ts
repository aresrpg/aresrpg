// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const random_secret = () => randomBytes(32).toString('base64url')
export const hash_secret = (value: string) => createHash('sha256').update(value).digest('base64url')
export const secret_matches = (value: string, expected: string) => {
  const actual = Buffer.from(hash_secret(value))
  const target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}
export const opaque_parts = (token: string): readonly [string, string] => {
  const parts = token.split('.')
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]{43}$/.test(part))) throw new Error('invalid_token')
  return [parts[0]!, parts[1]!]
}
export const require_string = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('invalid_request')
  return value
}
