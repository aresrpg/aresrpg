// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// POOLS DEPLOYMENT — back-compat shim over THE single merged home (`deployment/aresrpg.js`). The S-46
// merge collapsed `aresrpg_pools` into the ONE `aresrpg` package; `POOL_REGISTRY` survives in the merged
// map (pool derivation parent — its mint/burn cap-custody fields died, and `pool::buy`/`sell` no longer
// take it as an argument).
export {
  aresrpg_deployment as pools_deployment,
  aresrpg_deployment_ready as pools_deployment_ready,
} from './aresrpg.js'
