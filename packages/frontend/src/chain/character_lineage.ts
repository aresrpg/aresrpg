// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KIOSK CHARACTER-TYPE FILTER — derived from the SDK deployment home, NEVER a hardcoded lineage (audit row 12).
//
// The bug this replaces: a retired `DEMO_PACKAGE_ID` (0xaa8ea807…) was the ONLY accepted Character type, so a
// fresh publish (which RE-STAMPS the package's type-origin id) left the kiosk filter matching a dead lineage —
// prod characters were miscategorised / invisible after every republish. The Character struct's type origin is
// the merged `aresrpg` package's PACKAGE_ID (frozen at first publish, re-stamped by each fresh publish); reading
// it through the SDK's single id home means a republish is followed AUTOMATICALLY — no 0x… survives on the
// display path. A leaf on purpose: both the store and its test consume the SAME derivation (one home).

import { normalizeStructTag } from '@mysten/sui/utils'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { DEMO_NETWORK } from './deployment'

// The merged `aresrpg` package's type-origin id for the app's network. `aresrpg_id` is the READ accessor —
// returns '' pre-ceremony and NEVER throws, so an unstamped network degrades to a filter that matches nothing
// (safe) instead of crashing module load. The SDK models exactly ONE live lineage per network; a fresh publish
// re-stamps it here, so this const is the whole "lineage set" the SDK knows.
export const ARESRPG_PACKAGE_ID = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')

/** The fully-qualified, normalised `Character` type for a package id ('' when the id is unset). */
export const character_type_id = (pkg: string = ARESRPG_PACKAGE_ID): string =>
  pkg ? normalizeStructTag(`${pkg}::character::Character`) : ''

const CHARACTER_TYPE = character_type_id()

/**
 * True when `type` is the CURRENT deployment's Character. Both sides are normalised so a non-0x-padded chain
 * type still compares equal, and the match is PACKAGE-SCOPED — never the bare `::character::Character` suffix (a
 * dead/foreign lineage shares the struct name, and a wallet's zkLogin address is identical across lineages, so
 * a suffix match would mistake a foreign character for ours). Never throws on a malformed type.
 */
export const is_aresrpg_character = (type: string): boolean => {
  if (!CHARACTER_TYPE) return false
  try {
    return normalizeStructTag(type) === CHARACTER_TYPE
  } catch {
    return false
  }
}
