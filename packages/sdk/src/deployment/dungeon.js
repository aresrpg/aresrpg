// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DUNGEON DEPLOYMENT — back-compat shim over THE single merged home (`deployment/aresrpg.js`). The S-46
// merge collapsed `aresrpg_dungeon` into the ONE `aresrpg` package; `DungeonRegistry` was DELETED (pure
// cap custody — no dungeon door takes a registry anymore).
export {
  aresrpg_deployment as dungeon_deployment,
  aresrpg_deployment_ready as dungeon_deployment_ready,
} from './aresrpg.js'
