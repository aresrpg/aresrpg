// LOOTBOX RESOLVER regression (live Sui testnet) — pins the item.move event-type + field-name fix.
//
// WHY THIS EXISTS: get_item_templates discovered ItemTemplate object ids by replaying a Move event type,
// filtering on `${package_id}::template::ItemTemplateCreated`. That module/struct does NOT exist on the merged
// package — item.move's module is `item`, emitting `TemplateCreated` (item.move:104) — so the filter matched
// ZERO events, and get_template_map()/get_template_by_item_type_map() silently resolved EMPTY for every
// consumer (equip/consumable/crush/lootbox/marketplace/scribe/admin-editor). Surfaced in the field as
// `[lootbox] could not resolve the box template (item_type=pet_lootbox)`. A SECOND latent bug rode along:
// normalize_item_template read `f.item_category`, but item.move's ItemTemplate struct field is `category`
// (item.move:83-91) — invisible while the event filter returned zero rows, it would have decoded every
// template's category to '' (and mistagged every template `_orphan`) the moment the event filter was fixed
// without it. Both proven on live testnet 2026-07-14 (probe: OLD filter → 0 events, NEW filter → 1834 events,
// pet_lootbox resolves to a real `category: "consumable"` ItemTemplate). This test drives the REAL SHIPPED
// get_item_templates against the live chain so a future event-type/field drift turns it RED immediately.
//
// SCOPE NOTE: get_mob_templates has the SAME `template::MobTemplateCreated` event-type mismatch (mob_template.move's
// module is `mob_template`) PLUS separate field-name mismatches in normalize_mob_template (reads `f.level`/`f.hp`;
// the struct has `min_level`/`max_level`/`base_hp`) — left AS-IS (out of scope for the pet-lootbox fix; mob
// templates aren't on the lootbox path) and flagged for a follow-up ticket rather than fixed blind here.
//
// NETWORK: hits the live testnet GraphQL endpoint via the app's own get_sdk(). ON by default; set
// ARES_SKIP_LIVE=1 to skip in an offline CI lane (mirrors live_reads.test.js's D105 convention).

import { describe, expect, it } from 'bun:test'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { get_item_templates } from './read_templates.js'
import { get_sdk } from './sdk'
import { DEMO_NETWORK } from './deployment'

const PACKAGE_ID = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')

const LIVE = process.env.ARES_SKIP_LIVE !== '1'
const d = LIVE ? describe : describe.skip
const NET_TIMEOUT = 60_000

d('read_templates event-type regression (testnet)', () => {
  it(
    'get_item_templates resolves a non-empty catalog including pet_lootbox (item::TemplateCreated, category field)',
    async () => {
      const sdk = await get_sdk()
      const templates = await get_item_templates(sdk.graphql_client, PACKAGE_ID)
      // A stale `template::ItemTemplateCreated` filter matches zero events → this would be [] (the exact
      // field-visible defect). The live corpus carries hundreds of seeded ItemTemplates.
      expect(templates.length).toBeGreaterThan(0)
      const pet_lootbox = templates.find((t) => t.item_type === 'pet_lootbox')
      expect(pet_lootbox).toBeDefined()
      // The resolver-miss symptom: open_box only checks `template?.id` — proves the lootbox door actually opens.
      expect(pet_lootbox.id).toBeTruthy()
      // category field-name fix: was '' (and every template mistagged _orphan) under the stale `item_category` key.
      expect(pet_lootbox.category).toBe('CONSUMABLE')
    },
    NET_TIMEOUT
  )
})
