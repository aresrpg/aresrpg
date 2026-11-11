// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const display_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`

/** All consumers normalize SuiNS syntax through this single transform. */
export const canonical_suins_name = (value: string): string => {
  const name = value.trim().toLowerCase()
  if (name.startsWith('@')) return `${name.slice(1)}.sui`
  const subname = /^([^@\s]+)@([^@\s]+)$/.exec(name)
  return subname ? `${subname[1]}.${subname[2]}.sui` : name
}

/** Naming convention only; this never certifies an agent or its authority. */
export const application_suins_name = (
  value: string
): Readonly<{ kind: 'player' | 'agent'; parent: string }> | null => {
  const match = /^(aresrpg|aresrpgagent)\.(.+\.sui)$/.exec(canonical_suins_name(value))
  return match ? { kind: match[1] === 'aresrpg' ? 'player' : 'agent', parent: match[2]! } : null
}

/** Keep every relative label; distinct nested defaults must not collapse together. */
export const display_suins_name = (value: string): string => {
  const name = canonical_suins_name(value)
  const application = application_suins_name(name)
  const relative = (application?.parent ?? name).replace(/\.sui$/, '')
  return name.endsWith('.sui') && relative ? `@${relative}` : value
}

export const chat_suins_prefix = (name: string | null | undefined): string =>
  name ? `(${display_suins_name(name)}) ` : ''
