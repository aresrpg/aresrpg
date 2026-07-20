// scribe_detail.ts — the runeforge LEFT card's pure detail-props builder, split out of scribe.tsx so it is
// unit-testable without dragging in scribe.tsx's `../auth` import: auth/index.ts calls registerEnokiWallets()
// at MODULE LOAD, which crashes on `window is not defined` in this repo's DOM-less bun:test env (no jsdom —
// see item_detail_view.test.tsx). Mirrors the SAME split kolizeum_gate.ts already uses for kolizeum.tsx.
//
// CHARACTERISTICS BUG (prod regression, live v35): the /v1 template catalog's `statsJson` is a
// DELIBERATE '{}' (read_findables.js:43-44 — "the current indexer projection deliberately has no
// template-stat DF"), so a template row ALONE can never carry real numbers — the runeforge card rendered an
// honest-looking but permanently empty CHARACTERISTICS block for every piece of gear.
//
// An item's REAL stats are a per-INSTANCE dynamic field (`item_stats::StatsKey`, rolled at mint/buy —
// item.move / item_stats.move: `attach_rolled`/`rolled_stats`), NOT part of the shared template at all — the
// template only carries the min/max RANGE the roll was drawn from. The chain-direct read for that instance
// field already exists and is already wired into the SDK: `sdk.get_rolled_stats(item_id)`
// (packages/sdk/src/sui/read/items.js `get_rolled_stats`), the SAME read the crush action already uses for
// this exact gear (world-shell/crush_actions.js `crush_preview`/`crush_item`) — one home for "this item's
// real stats" across forgemagie. `gear_stats` (the resolved read) wins over the template's placeholder when
// it has landed; falls back to the template's honest empty while the read is in flight or the item carries
// none (never fabricated).

import { onchain_template_to_detail_props } from '../components/items'
import { item_display_level } from '../game/screens/hud/inventory-equip.js'
import type { use_template_t } from '../i18n/template_t'

export type Item = {
  id: string
  item_type: string
  item_category: string
  name: string
  level: number
  amount: number
  quality?: string
  rarity?: string
}

/**
 * The selected gear's template + its real rolled stats → the shared ItemDetailView props (display-first +
 * decoded stats), the SAME adapter path findables/recall/inventory-hover use. null until a gear is picked or
 * the template map is still loading (honest empty, never fabricated).
 * @param sel_gear the selected bag/equipment row (Item shape above), or null when nothing is picked
 * @param template_map item_type slug -> template row (get_template_by_item_type_map, read_findables.js)
 * @param gear_stats the item's real rolled stats (sdk.get_rolled_stats(sel_gear.id)), or null while that
 *   read is in flight / unavailable — the template's own (always-empty) statsJson is the honest fallback
 * @param tt use_template_t() — localizes the template's name/description
 */
export function scribe_detail_props(
  sel_gear: Item | null,
  template_map: Map<string, any>,
  gear_stats: Record<string, number> | null,
  tt: ReturnType<typeof use_template_t>
) {
  if (!sel_gear) return null
  const tmpl = template_map.get(sel_gear.item_type)
  if (!tmpl) return null
  return onchain_template_to_detail_props(
    {
      ...tmpl,
      item_type: sel_gear.item_type,
      // the ONE display-level home (inventory-equip.js): a scribed instance level wins, else the template's
      level: item_display_level(sel_gear, tmpl),
      // the template's own statsJson is always '{}' (see file header) — the rolled per-item read wins the
      // instant it lands; falls back to the template's honest empty otherwise.
      statsJson: gear_stats ? JSON.stringify(gear_stats) : tmpl.statsJson,
    },
    tt
  )
}
