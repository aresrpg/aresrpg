// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KOLIZEUM DEPLOYMENT — back-compat shim over THE single id home (`deployment/aresrpg.js`, which holds EVERY
// package's ids — including the sibling `aresrpg_kolizeum`'s KOLIZEUM_PACKAGE_ID after the 2026-07-11 package-split).
// `KolizeumRegistry` is gone — start/seat call the engine's package-internal doors via the private KolizeumBrand
// witness. This shim re-exports the shared resolver; the kolizeum PTB builders guard KOLIZEUM_PACKAGE_ID themselves.
export {
  aresrpg_deployment as kolizeum_deployment,
  aresrpg_deployment_ready as kolizeum_deployment_ready,
} from './aresrpg.js'
