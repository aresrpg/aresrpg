// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GREEN fixture — all result enrichment is carried by the canonical fight-visible projection.
export const enrich_result = (world_fight_view) => ({
  rolled_stats: world_fight_view.rolled_stats,
  templates_by_item_type: world_fight_view.templates_by_item_type,
  template_details: world_fight_view.template_details,
  character_docs: world_fight_view.character_docs,
})
