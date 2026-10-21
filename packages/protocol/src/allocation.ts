// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AllocationStatus, Submission } from '@aresrpg/immutable/allocation'

export type AllocationRequest =
  | Readonly<{ action: 'status' }>
  | Readonly<{ action: 'wallet_challenge'; address: string; label: string }>
  | Readonly<{ action: 'wallet_verify'; nonce: string; signature: string }>
  | Readonly<{ action: 'wallet_remove' | 'share'; address: string }>
  | Readonly<{ action: 'link_x' }>
  | Readonly<{ action: 'complete_x'; token: string }>
  | Readonly<{ action: 'submit'; address: string; urls: readonly string[] }>
export type AllocationResult =
  | Readonly<{ action: 'status'; status: AllocationStatus }>
  | Readonly<{ action: 'wallet_challenge'; nonce: string; message: string }>
  | Readonly<{ action: 'wallet_verify' | 'wallet_remove' }>
  | Readonly<{ action: 'share'; url: string }>
  | Readonly<{ action: 'link_x'; url: string }>
  | Readonly<{ action: 'complete_x' }>
  | Readonly<{ action: 'submit'; submission: Submission }>
  | Readonly<{ action: 'error'; error: string }>

const strings = (value: unknown, limit: number, length: number): boolean =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every((item) => typeof item === 'string' && item.length <= length)
const text = (value: unknown, length: number): boolean => typeof value === 'string' && value.length <= length
export const valid_allocation_request = (value: unknown): value is AllocationRequest => {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  const checks: Readonly<Record<string, () => boolean>> = {
    status: () => true,
    wallet_challenge: () => text(request.address, 66) && text(request.label, 64),
    wallet_verify: () => text(request.nonce, 64) && text(request.signature, 12000),
    wallet_remove: () => text(request.address, 66),
    share: () => text(request.address, 66),
    link_x: () => true,
    complete_x: () => text(request.token, 64),
    submit: () => text(request.address, 66) && strings(request.urls, 3, 300),
  }
  return typeof request.action === 'string' && Object.hasOwn(checks, request.action) && checks[request.action]()
}
