// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED fixture — result enricher bypasses, shaped like FightReport.jsx:95.
export const enrich_result = (item_id, template_ids, roster_ids) => {
  void resolve_rolled_stats(item_id).then(() => {})
  void Promise.all([get_template_by_item_type_map(), get_template_detail_map(template_ids)]).then(() => {})
  void resolve_character_docs(roster_ids).then(() => {})
}
