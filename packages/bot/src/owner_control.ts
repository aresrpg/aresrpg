// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Grant } from './model.ts'

// Only grant-first public control methods cross the trusted process boundary.
export const OWNER_CONTROL_SCOPES = {
  accept: 'bot:play',
  status: 'bot:observe',
  pause: 'bot:pause',
  resume: 'bot:pause',
  validate_behavior: 'bot:observe',
  behavior_status: 'bot:observe',
  start_behavior: 'bot:play',
  replace_behavior: 'bot:play',
  stop_behavior: 'bot:pause',
  validate_combat_profile: 'bot:observe',
} as const
export type OwnerControlMethod = keyof typeof OWNER_CONTROL_SCOPES
export type OwnerControl = (grant: Grant, method: OwnerControlMethod, args: readonly unknown[]) => Promise<unknown>
export type OwnerExpectation = Readonly<{ actor_id: string; fence: number; deadline: number }>
export type LocalOwnerControl = (
  grant: Grant,
  method: OwnerControlMethod,
  args: readonly unknown[],
  expected: OwnerExpectation
) => Promise<unknown>
export const owner_control_method = (value: unknown): value is OwnerControlMethod =>
  typeof value === 'string' && Object.hasOwn(OWNER_CONTROL_SCOPES, value)
// Durable stop authority and static validation do not require a live actor. Stop writes only its
// hero's run record. Pause writes the lane on purpose: it fences the whole wallet, so the only
// in-flight transition its write can refuse is one that a paused wallet refuses anyway.
export const route_owner_controls = <T extends object>(local: T, route?: OwnerControl): T => {
  if (!route) return local
  return Object.fromEntries(
    Object.entries(local).map(([method, operation]) => [
      method,
      owner_control_method(method) && !['pause', 'stop_behavior', 'validate_behavior'].includes(method)
        ? (grant: Grant, ...args: readonly unknown[]) => route(grant, method, args)
        : operation,
    ])
  ) as T
}
