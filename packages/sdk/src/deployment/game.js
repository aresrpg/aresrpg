// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GAME DEPLOYMENT — back-compat shim over THE single merged home (`deployment/aresrpg.js`). The S-46
// merge collapsed `aresrpg_game` into the ONE `aresrpg` package; `CHARACTER_LINK` and
// `EQUIPMENT_REGISTRY` DIED with it (custody objects deleted — no door takes them anymore). The game
// singletons that survive (GAME_CONFIG / PET_FEED_CONFIG) live in the merged map.
export {
  aresrpg_deployment as game_deployment,
  aresrpg_deployment_ready as game_deployment_ready,
} from './aresrpg.js'
