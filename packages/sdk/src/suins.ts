// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** `@name` → `name.sui`, `sub@name` → `sub.name.sui`, anything else passes through. */
export const canonical_suins_name = (value: string): string => {
  const name = value.trim().toLowerCase()
  if (name.startsWith('@')) return `${name.slice(1)}.sui`
  const subname = /^([^@\s]+)@([^@\s]+)$/.exec(name)
  return subname ? `${subname[1]}.${subname[2]}.sui` : name
}
