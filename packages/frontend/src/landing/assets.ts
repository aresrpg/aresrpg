// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import portrait from '../../../../seed/icons/characters/senshi_male_hd.png'
import item_key from '../../../../seed/icons/items/key_of_ivory_rampart_hd.png'
import item_horn from '../../../../seed/icons/items/tidal_horn_core_hd.png'
import item_bow from '../../../../seed/icons/items/amberwood_recurve_hd.png'

import { create_landing_assets } from './presentation.ts'

export const landing_assets = create_landing_assets({ portrait, item_key, item_horn, item_bow })
