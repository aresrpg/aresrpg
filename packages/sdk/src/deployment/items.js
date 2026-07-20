// ITEMS DEPLOYMENT — back-compat shim over THE single merged home (`deployment/aresrpg.js`). The S-46
// single-package merge collapsed the `aresrpg_items` lineage (and its siblings) into the ONE `aresrpg`
// package: same map, same gate, same override seam. Kept because this path is a public package export
// (`@aresrpg/sdk/deployment/items` — the frontend mint/shop reads import it); the resolved id set is the
// full merged block (PACKAGE_ID / VERSION / CREATION / CATALOG / ITEM_POLICY / CHARACTER_POLICY / …).
export {
  aresrpg_deployment as items_deployment,
  aresrpg_deployment_ready as items_deployment_ready,
} from './aresrpg.js'
