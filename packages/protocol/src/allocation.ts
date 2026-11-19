// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AllocationStatus } from '@aresrpg/immutable/allocation'

export type AllocationRequest =
  | Readonly<{ action: 'status' }>
  | Readonly<{ action: 'wallet_challenge'; address: string; label: string }>
  | Readonly<{ action: 'wallet_verify'; nonce: string; signature: string }>
  | Readonly<{ action: 'wallet_remove' | 'share'; address: string }>
export type AllocationResult =
  | Readonly<{ action: 'status'; status: AllocationStatus }>
  | Readonly<{ action: 'wallet_challenge'; nonce: string; message: string }>
  | Readonly<{ action: 'wallet_verify' | 'wallet_remove' }>
  | Readonly<{ action: 'share'; url: string }>
  | Readonly<{ action: 'error'; error: string }>

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
  }
  return typeof request.action === 'string' && Object.hasOwn(checks, request.action) && checks[request.action]()
}
