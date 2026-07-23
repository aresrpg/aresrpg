// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ITEM-TYPE LINEAGE FILTER — the item equivalent of ./character_lineage (issue #524): items minted under a
// RETIRED package universe (pre-republish) still sit in a player's kiosk on-chain forever (a republish never
// deletes old objects) and must never enter a read result — the same way is_aresrpg_character keeps a
// dead-lineage Character out of the kiosk filter. Derived from the SDK deployment home, never hardcoded, so a
// fresh publish (which RE-STAMPS the package's type-origin id) is followed automatically.
//
// Reuses character_lineage's ARESRPG_PACKAGE_ID rather than re-deriving it: Item and Character share ONE
// deployment lineage (the same merged `aresrpg` package), so a second `aresrpg_id(...)` call here would just
// be a second home for the identical fact.

import { normalizeStructTag } from '@mysten/sui/utils'

import { ARESRPG_PACKAGE_ID } from './character_lineage'

/** The fully-qualified, normalised `Item` type for a package id ('' when the id is unset). */
export const item_type_id = (pkg: string = ARESRPG_PACKAGE_ID): string =>
  pkg ? normalizeStructTag(`${pkg}::item::Item`) : ''

const ITEM_TYPE = item_type_id()

/**
 * True when `type` is the CURRENT deployment's Item. Both sides are normalised so a non-0x-padded chain
 * type still compares equal, and the match is PACKAGE-SCOPED — never the bare `::item::Item` suffix (a
 * dead/foreign lineage shares the struct name). Never throws on a malformed type.
 */
export const is_aresrpg_item = (type: string): boolean => {
  if (!ITEM_TYPE) return false
  try {
    return normalizeStructTag(type) === ITEM_TYPE
  } catch {
    return false
  }
}
