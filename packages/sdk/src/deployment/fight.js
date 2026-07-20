// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT DEPLOYMENT — back-compat shim over THE single merged home (`deployment/aresrpg.js`). The S-46
// merge collapsed `aresrpg_fight` into the ONE `aresrpg` package; `FIGHT_REGISTRY` survives in the merged
// map (derivation parent + in-fight latch — its cap-custody fields died).
export {
  aresrpg_deployment as fight_deployment,
  aresrpg_deployment_ready as fight_deployment_ready,
} from './aresrpg.js'
