// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import { truncate_address } from '../utils/address'

// D52 (SPEC §13 "Identity") — the ONE presentation path for a wallet's display identity: the resolved
// SuiNS default name as "@handle" when one exists, else the house shortened-address format. Purely
// presentational (no fetch of its own): a panel batch-resolves its whole visible address set through
// rpc/use_address_names in ONE /v1/names round trip and feeds each row's resolved name in via `name` —
// never a resolution call per row, never copied resolution logic per site. The address stays the
// identity; the name is decorative only, so an unresolved/failed lookup silently falls back, never a
// broken row.
export function AddressName({
  address,
  name,
  fallback = '—',
  className,
}: {
  address?: string | null
  /** the resolved default SuiNS domain (e.g. "alice.sui"), or null when confirmed nameless, or
   *  undefined while still resolving — all three render the shortened-address fallback. */
  name?: string | null
  /** shown when `address` itself is falsy (house convention: an em dash, matching every prior local
   *  short_addr()). Callers with a more specific placeholder (e.g. chat's "Adventurer") can override it. */
  fallback?: ReactNode
  className?: string
}) {
  const label = address ? (name ? `@${name.replace(/\.sui$/i, '')}` : truncate_address(address)) : fallback
  return className ? <span className={className}>{label}</span> : <>{label}</>
}
