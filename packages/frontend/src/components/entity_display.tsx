// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shell: entity_display.tsx used to hold every entity-display concern in one 900+ LoC file. It's now
// split into cohesive sibling modules (colors/labels, the "new" badge, shared section chrome, the item
// view, the mob view, and the shared on-chain tooltip hook) and re-exported here so every existing
// import of `../entity_display` / `./entity_display` keeps resolving unchanged.

export {
  STAT_COLORS,
  ELEMENT_COLORS,
  RANK_COLORS,
  CATEGORY_COLORS,
  STAT_LABEL_KEYS,
  format_stat_name,
  stat_color_key,
  stat_label,
  sort_stat_entries,
} from './entity_colors'

export { is_new_template, EntityBadge, NewBadge, ArchiBadge } from './entity_new_badge'

export { SectionDivider, SectionTitle } from './entity_section'

export { ConsumableEffectLine, ItemDetailView } from './item_detail_view'

export { MobDetailView } from './mob_detail_view'

export { useOnchainItemTooltip } from './entity_tooltip'
