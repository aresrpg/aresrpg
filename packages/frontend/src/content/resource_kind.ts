// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { gatherable_of } from '@aresrpg/immutable'

export const resource_kinds = Object.freeze(['raw', 'gatherable', 'intermediary', 'pet_food'] as const)
export type ResourceKind = (typeof resource_kinds)[number]

/** Resource presentation is derived, never authored: an exact three-rare output is pet food,
 * another recipe output is intermediary, a gathering-catalog identity is gatherable, and
 * every remaining resource is raw. */
export const item_resource_kind = (item_type: string, has_recipe: boolean, pet_food = false): ResourceKind =>
  pet_food ? 'pet_food' : has_recipe ? 'intermediary' : gatherable_of(item_type) ? 'gatherable' : 'raw'
