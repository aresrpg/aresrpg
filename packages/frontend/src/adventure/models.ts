// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import goblin_1 from '../../../../seed/models/demo/goblin_1.glb?url'
import goblin_3 from '../../../../seed/models/demo/goblin_3.glb?url'
import goblin_5 from '../../../../seed/models/demo/goblin_5.glb?url'

const models: Readonly<Record<string, string>> = Object.freeze({
  demo_goblin_1: goblin_1,
  demo_goblin_3: goblin_3,
  demo_goblin_5: goblin_5,
})
export const adventure_model = (mob_type: string) => {
  const model_url = models[mob_type]
  return model_url ? Object.freeze({ model_url, variant: null }) : null
}
