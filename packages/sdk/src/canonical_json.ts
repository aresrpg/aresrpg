// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const canonical_json = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    return Object.fromEntries(
      Object.keys(entry)
        .sort()
        .map((key) => [key, Reflect.get(entry, key)])
    )
  })
