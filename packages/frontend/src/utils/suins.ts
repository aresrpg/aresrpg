// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// suins.ts — forward SuiNS name → address resolution for the Send-SUI recipient field. Display reads stay on
// the keyless /v1 read API; the browser never constructs a chain client for this lookup.

import { game_log } from '../core/log.js'
import { rpc_get } from '../rpc/client'

/** True for any SuiNS display form: the domain form ("alice.sui", subdomains included), the "@alice"
 * shorthand, or the subname form ("treasury@aresrpg" = treasury.aresrpg.sui — confirmed in practice, 2026-07-15).
 * Deliberately permissive — the server-side /v1 lookup is the real validator; a false positive here
 * just resolves to a clean "not found" instead of falling through to the player-name search. */
export function is_suins_name(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('@')) return v.length > 1
  if (/^[^@\s]+@[^@\s]+$/.test(v)) return true
  return /\.sui$/i.test(v)
}

/** Normalize every accepted display form to the canonical dotted name the /v1 lookup takes:
 * "@alice" → "alice.sui" · "treasury@aresrpg" → "treasury.aresrpg.sui" · "alice.sui" → unchanged. */
export function canonical_suins_name(value: string): string {
  const v = value.trim()
  if (v.startsWith('@')) return `${v.slice(1)}.sui`
  const subname = /^([^@\s]+)@([^@\s]+)$/.exec(v)
  if (subname) return `${subname[1]}.${subname[2]}.sui`
  return v
}

/** Resolve a SuiNS name to its target Sui address. Returns null on ANY failure — unregistered name, no target
 * address set, or an RPC hiccup — so the caller always shows a humanized inline error, never a raw throw
 * (CLAUDE.md no-silent-failure law). The mechanical cause still lands in the console. */
export async function resolve_suins_address(name: string): Promise<string | null> {
  try {
    const { address } = await rpc_get<{ name: string; address: string }>('/v1/suins', {
      name: canonical_suins_name(name),
    })
    return address ?? null
  } catch (e) {
    game_log('suins', 'lookup failed —', name, e)
    return null
  }
}
