// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Is this string a Sui object id? A pure shape predicate over an arbitrary value — it carries no content,
// no ids, and no build-time state, so it lives apart from the seed receipt that used to export it
// (#1467: importing the receipt is fenced by the seed-receipt-boot-paint-only arch rule, and a module that
// only wants to validate a string's SHAPE is not a receipt consumer).
export function is_object_id(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}
