// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { PetWingStyle } from '@aresrpg/engine'

import source from '../../../../seed/content/pet_wings.json'

const styles = source as unknown as Readonly<Record<string, PetWingStyle>>
export const pet_wing_style = (item_type: string): PetWingStyle | undefined => styles[item_type]
