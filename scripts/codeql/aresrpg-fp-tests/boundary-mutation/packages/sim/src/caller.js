// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cross-module caller — the boundary the law protects.
import { apply_damage, sanitize } from './lib.js'

export const round = (unit) => sanitize(apply_damage(unit, 3))
