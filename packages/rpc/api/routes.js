// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure public-route table. Keeping the map outside server.js lets unit tests assert literal route wiring
// without importing the Bun.serve listener.

import { handle_parties } from './parties_view.js'
import { handle_suins } from './suins_view.js'
import {
  handle_characters,
  handle_commissions,
  handle_config,
  handle_dungeon_runs,
  handle_encyclopedia,
  handle_fight_results,
  handle_fights,
  handle_kolizeum,
  handle_listings,
  handle_names,
  handle_owner_items,
  handle_pending_outcomes,
  handle_pet_claims,
  handle_pools,
  handle_protector_trigger,
  handle_rare_links,
  handle_sales_history,
  handle_shop,
  handle_sponsor_remaining,
  handle_status,
  handle_taux,
  handle_zones,
} from './views.js'

export const ROUTES = Object.freeze({
  '/v1/status': handle_status,
  '/v1/characters': handle_characters,
  '/v1/owner-items': handle_owner_items,
  '/v1/listings': handle_listings,
  '/v1/sales-history': handle_sales_history,
  '/v1/pools': handle_pools,
  '/v1/shop': handle_shop,
  '/v1/zones': handle_zones,
  '/v1/encyclopedia': handle_encyclopedia,
  '/v1/config': handle_config,
  '/v1/kolizeum': handle_kolizeum,
  '/v1/dungeon-runs': handle_dungeon_runs,
  '/v1/commissions': handle_commissions,
  '/v1/fights': handle_fights,
  '/v1/protector-trigger': handle_protector_trigger,
  '/v1/fight-results': handle_fight_results,
  '/v1/pending-outcomes': handle_pending_outcomes,
  '/v1/pet-claims': handle_pet_claims,
  '/v1/taux': handle_taux,
  '/v1/rare-links': handle_rare_links,
  '/v1/parties': handle_parties,
  '/v1/names': handle_names,
  '/v1/suins': handle_suins,
  '/v1/sponsor/remaining': handle_sponsor_remaining,
})
